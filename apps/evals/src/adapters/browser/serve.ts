import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export type ServeMode = 'dev' | 'preview';

function stop(child: ChildProcess) {
  if (child.exitCode !== null || !child.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

/**
 * Serve the example gallery for one run. `dev` serves the current source, so a hillclimb round's
 * edits apply without a build; `preview` serves `make build-apps` output as people receive it.
 * Portless stays off so the URL is plain `http://127.0.0.1:<port>/`.
 */
export async function serveGallery(repoRoot: string, mode: ServeMode, port: number, signal: AbortSignal) {
  const cwd = join(repoRoot, 'examples/gallery');
  const vp = join(cwd, 'node_modules/.bin/vp');
  const command =
    mode === 'dev'
      ? `node scripts/sync-generated.mjs && ${vp} dev --host 127.0.0.1 --port ${port} --strictPort`
      : `${vp} preview --host 127.0.0.1 --port ${port} --strictPort`;
  const child = spawn('/bin/sh', ['-c', command], {
    cwd,
    detached: true,
    env: { ...process.env, PORTLESS: '0', PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (chunk) => (stderr = `${stderr}${chunk}`.slice(-4000)));
  const url = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    if (child.exitCode !== null) throw new Error(`Gallery ${mode} server exited: ${stderr.trim()}`);
    const ok = await fetch(url).then(
      (response) => response.ok,
      () => false,
    );
    if (ok) return { url, close: () => stop(child) };
    await sleep(500);
  }
  stop(child);
  throw new Error(`Gallery ${mode} server did not answer on ${url}`);
}
