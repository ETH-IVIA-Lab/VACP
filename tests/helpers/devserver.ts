import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

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

export async function startViteDevServer(args: {
  name: string;
  cwd: string;
  port?: number;
  artifactsDir?: string;
}): Promise<DevServer> {
  const port = args.port ?? (await freePort());
  const url = `http://127.0.0.1:${port}/`;

  const artifactsDir = args.artifactsDir ?? resolve(process.cwd(), '.artifacts', 'playwright-examples-smoke');
  await mkdir(artifactsDir, { recursive: true });
  const logPath = join(artifactsDir, `${args.name}.dev.log`);
  await writeFile(logPath, '', 'utf8');

  const proc = spawn('pnpm', ['dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: args.cwd,
    env: { ...process.env, BROWSER: 'none', VACP_VITE_CACHE_DIR: `node_modules/.vite-${args.name}-${port}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout?.on('data', (buf) => void writeFile(logPath, buf, { flag: 'a' }));
  proc.stderr?.on('data', (buf) => void writeFile(logPath, buf, { flag: 'a' }));

  try {
    await waitHttpReady(url, 45_000);
  } catch (err) {
    proc.kill('SIGTERM');
    throw err;
  }

  return {
    name: args.name,
    cwd: args.cwd,
    port,
    url,
    stop: async () => {
      if (proc.exitCode !== null) return;
      proc.kill('SIGTERM');
      await new Promise<void>((resolveStop) => {
        const t = setTimeout(() => {
          proc.kill('SIGKILL');
          resolveStop();
        }, 10_000);
        proc.once('exit', () => {
          clearTimeout(t);
          resolveStop();
        });
      });
    },
  };
}
