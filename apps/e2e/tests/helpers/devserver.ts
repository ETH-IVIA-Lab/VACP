import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { artifactDir } from './paths';

export type DevServer = {
  name: string;
  cwd: string;
  port: number;
  url: string;
  stop: () => Promise<void>;
};

export async function freePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => {
        if (!addr || typeof addr === 'string') return reject(new Error('Failed to allocate port'));
        resolvePort(addr.port);
      });
    });
  });
}

async function waitHttpReady(url: string, timeoutMs = 45_000): Promise<void> {
  const start = Date.now();

  while (true) {
    try {
      const res = await fetch(url, { method: 'GET' });

      if (res.ok) return;
    } catch {
      // ignore
    }

    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for server: ${url}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

export async function startAppServer(args: {
  name: string;
  cwd: string;
  port?: number;
  script?: 'dev' | 'preview';
  artifactsDir?: string;
}): Promise<DevServer> {
  const port = args.port ?? (await freePort());
  const url = `http://127.0.0.1:${port}/`;

  const artifactsDir = args.artifactsDir ?? artifactDir('playwright-examples-smoke');
  await mkdir(artifactsDir, { recursive: true });
  const logPath = join(artifactsDir, `${args.name}.dev.log`);
  await writeFile(logPath, '', 'utf8');

  const proc = spawn('pnpm', [args.script ?? 'dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: args.cwd,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      PORTLESS: '0',
      BROWSER: 'none',
      VACP_VITE_CACHE_DIR: `node_modules/.vite-${args.name}-${port}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stdout?.on('data', (buf) => void writeFile(logPath, buf, { flag: 'a' }));
  proc.stderr?.on('data', (buf) => void writeFile(logPath, buf, { flag: 'a' }));

  const stop = () => stopProcess(proc);

  try {
    await waitHttpReady(url, 45_000);
  } catch (error) {
    await stop();
    throw error;
  }

  return { name: args.name, cwd: args.cwd, port, url, stop };
}

/** Stop the process group, including children started by pnpm and Portless. */
export async function stopProcess(proc: ChildProcess): Promise<void> {
  const signalTree = (signal: NodeJS.Signals) => {
    if (!proc.pid) return;

    try {
      if (process.platform === 'win32') {
        if (proc.exitCode !== null || proc.signalCode !== null) return;
        execFileSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        process.kill(-proc.pid, signal);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };

  if (proc.exitCode !== null || proc.signalCode !== null) return;
  await new Promise<void>((resolveStop) => {
    const timeout = setTimeout(() => {
      signalTree('SIGKILL');
      resolveStop();
    }, 10_000);

    proc.once('exit', () => {
      clearTimeout(timeout);
      resolveStop();
    });
    signalTree('SIGTERM');
  });
}
