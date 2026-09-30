import type { HarnessV1NetworkSandboxSession } from '@ai-sdk/harness';
import { spawn as spawnProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join } from 'node:path';
import { Readable } from 'node:stream';

type Session = ReturnType<HarnessV1NetworkSandboxSession['restricted']>;
type ProcessOptions = Parameters<Session['run']>[0];
type SandboxProcess = Awaited<ReturnType<Session['spawn']>>;

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

async function readOrNull(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** End a process group, including members whose leader already exited. */
function signalGroup(group: number) {
  try {
    process.kill(-group, 'SIGTERM');
  } catch {
    // Every member already exited.
  }
}

async function bytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * A harness sandbox on this machine: commands run as the current user through `/bin/sh` in a
 * private working directory, with `HOME` pointed at the condition's own directory. That `HOME`
 * persists across runs, so each runtime installs once, and the user's own agent settings,
 * credentials, and MCP servers stay out of the eval. Processes see `PATH` and nothing else from the
 * host environment unless the harness adapter passes it.
 */
export class LocalSandbox implements HarnessV1NetworkSandboxSession {
  readonly id: string;
  readonly description: string;
  readonly defaultWorkingDirectory: string;
  readonly ports: ReadonlyArray<number>;
  private readonly env: Record<string, string>;
  /**
   * The process group of every command. Runtimes start their servers in the background, so a
   * group outlives the shell that leads it, and teardown signals the group itself.
   */
  private readonly groups = new Set<number>();

  private constructor(options: { id: string; home: string; work: string; port: number }) {
    this.id = options.id;
    this.defaultWorkingDirectory = options.work;
    this.ports = [options.port];
    this.env = {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: options.home,
      TMPDIR: join(options.home, 'tmp'),
      LANG: 'en_US.UTF-8',
      TERM: 'dumb',
      // pnpm and corepack keep their caches under HOME, which the sandbox owns.
      COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    };
    this.description = `A local working directory at ${options.work}. Port ${options.port} is reachable at 127.0.0.1.`;
  }

  /**
   * Create a sandbox under `root`: `root/home` is shared by the condition's sessions, `root/work/<id>`
   * is this one's. Harness bootstraps run `pnpm install`, which resolves the nearest pnpm workspace
   * above the working directory, so `root` must sit outside every workspace.
   */
  static async create(root: string): Promise<LocalSandbox> {
    for (let dir = root; dir !== dirname(dir); dir = dirname(dir))
      if (existsSync(join(dir, 'pnpm-workspace.yaml')))
        throw new Error(`Sandbox root ${root} is inside the pnpm workspace at ${dir}. Choose a directory outside it.`);
    const id = randomUUID();
    const home = join(root, 'home');
    const work = join(root, 'work', id);
    await Promise.all([mkdir(join(home, 'tmp'), { recursive: true }), mkdir(work, { recursive: true })]);
    return new LocalSandbox({ id, home, work, port: await freePort() });
  }

  private path(path: string) {
    return isAbsolute(path) ? path : join(this.defaultWorkingDirectory, path);
  }

  readFile: Session['readFile'] = async ({ path }) => {
    const data = await readOrNull(this.path(path));
    return data ? (Readable.toWeb(Readable.from([data])) as ReadableStream<Uint8Array>) : null;
  };

  readBinaryFile: Session['readBinaryFile'] = async ({ path }) => {
    const data = await readOrNull(this.path(path));
    return data ? new Uint8Array(data) : null;
  };

  readTextFile: Session['readTextFile'] = async ({ path, encoding, startLine, endLine }) => {
    const data = await readOrNull(this.path(path));
    if (!data) return null;
    const text = new TextDecoder(encoding ?? 'utf-8').decode(data);
    if (startLine === undefined && endLine === undefined) return text;
    return text
      .split('\n')
      .slice((startLine ?? 1) - 1, endLine)
      .join('\n');
  };

  writeBinaryFile: Session['writeBinaryFile'] = async ({ path, content }) => {
    const target = this.path(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  };

  writeFile: Session['writeFile'] = async ({ path, content }) =>
    await this.writeBinaryFile({ path, content: await bytes(content) });

  writeTextFile: Session['writeTextFile'] = async ({ path, content, encoding }) =>
    await this.writeBinaryFile({
      path,
      content:
        encoding && encoding !== 'utf-8' ? Buffer.from(content, encoding as BufferEncoding) : Buffer.from(content),
    });

  spawn: Session['spawn'] = async ({ command, workingDirectory, env, abortSignal }: ProcessOptions) => {
    // Each command leads its own process group, so killing it also ends what it started.
    const child = spawnProcess('/bin/sh', ['-c', command], {
      cwd: workingDirectory ? this.path(workingDirectory) : this.defaultWorkingDirectory,
      env: { ...this.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    if (child.pid !== undefined) this.groups.add(child.pid);
    const exited = new Promise<{ exitCode: number }>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {
        if (abortSignal?.aborted) reject(abortSignal.reason);
        else resolve({ exitCode: code ?? (signal ? 128 : 1) });
      });
    });
    const kill = async () => {
      if (child.pid !== undefined) signalGroup(child.pid);
    };
    abortSignal?.addEventListener('abort', () => void kill(), { once: true });
    const handle: SandboxProcess = {
      pid: child.pid,
      stdout: Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
      stderr: Readable.toWeb(child.stderr!) as ReadableStream<Uint8Array>,
      wait: () => exited,
      kill,
    };
    return handle;
  };

  run: Session['run'] = async (options) => {
    const child = await this.spawn(options);
    const [stdout, stderr, { exitCode }] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.wait(),
    ]);
    return { exitCode, stdout, stderr };
  };

  getPortEndpoint: HarnessV1NetworkSandboxSession['getPortEndpoint'] = async ({ port, protocol }) => ({
    url: `${protocol ?? 'http'}://127.0.0.1:${port}`,
  });

  getPortUrl: HarnessV1NetworkSandboxSession['getPortUrl'] = async (options) =>
    (await this.getPortEndpoint(options)).url;

  stop = async () => {
    for (const group of this.groups) signalGroup(group);
    this.groups.clear();
  };

  destroy = async () => {
    await this.stop();
    await rm(this.defaultWorkingDirectory, { recursive: true, force: true });
  };

  restricted = (): Session => ({
    description: this.description,
    readFile: this.readFile,
    readBinaryFile: this.readBinaryFile,
    readTextFile: this.readTextFile,
    writeFile: this.writeFile,
    writeBinaryFile: this.writeBinaryFile,
    writeTextFile: this.writeTextFile,
    spawn: this.spawn,
    run: this.run,
  });
}
