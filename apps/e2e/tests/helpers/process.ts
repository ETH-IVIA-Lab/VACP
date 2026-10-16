import { execFileSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

export async function freePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === 'string') return reject(new Error('Failed to allocate port'));
        resolvePort(address.port);
      });
    });
  });
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
