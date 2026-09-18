import net from 'node:net';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { consola } from 'consola';
import { createOpencodeClient } from '@opencode-ai/sdk/v2';
import type { ArenaConfig } from './types.js';
import { buildSpawnOpencodeConfig } from './opencode-config.js';

const DEFAULT_OPENCODE_SERVER_URL = 'http://127.0.0.1:4096';

export async function startServer(config: ArenaConfig, options?: { arenaStateDir?: string }) {
  const cfg = config.server;

  if (!cfg || cfg.mode === 'connect') {
    const baseUrl = cfg?.baseUrl ?? DEFAULT_OPENCODE_SERVER_URL;
    await waitForHealth(baseUrl, cfg?.timeoutMs ?? 8000);

    return {
      url: baseUrl,
      close() {},
    };
  }

  const hostname = cfg?.hostname ?? '127.0.0.1';
  const timeout = cfg?.timeoutMs ?? 8000;
  const cwd = path.resolve(config.directory ?? config.startDirectory ?? process.cwd());
  const stateDir = options?.arenaStateDir ? path.resolve(options.arenaStateDir) : path.join(cwd, '.agent-arena');

  const maxAttempts = 5;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const port = await pickPort(cfg?.port);

    try {
      return await spawnOpencodeServer({
        hostname,
        port,
        timeoutMs: timeout,
        cwd,
        stateDir,
        config: buildSpawnOpencodeConfig(config),
      });
    } catch (error) {
      lastError = error;

      if (!looksLikePortConflict(error)) throw error;

      if (attempt < maxAttempts) continue;
      throw error;
    }
  }

  // Unreachable, but keeps TS happy.
  throw lastError;
}

export function createClient(baseUrl: string, directory: string) {
  return createOpencodeClient({
    baseUrl,
    directory,
  });
}

async function spawnOpencodeServer(args: {
  hostname: string;
  port: number;
  timeoutMs: number;
  cwd: string;
  stateDir: string;
  config: Record<string, unknown>;
}) {
  const isolationEnv = await prepareIsolatedOpencodeEnv(args.stateDir);
  const detached = process.platform !== 'win32';

  const proc = spawn('opencode', ['serve', `--hostname=${args.hostname}`, `--port=${args.port}`], {
    cwd: args.cwd,
    detached,
    env: {
      ...process.env,
      ...isolationEnv,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(args.config ?? {}),
    },
    stdio: 'ignore',
  });

  const url = `http://${args.hostname}:${args.port}`;
  await waitForHealth(url, args.timeoutMs, proc);

  // Best-effort cleanup: if the CLI process exits for any reason, including
  // Ctrl-C default termination, ensure the spawned server does not linger in
  // the background.
  // Register process-level cleanup so the server is killed even when `close()`
  // is not awaited.
  const killOnExit = () => {
    try {
      killProcess(proc, 'SIGKILL');
    } catch {
      // ignore
    }
  };

  process.once('exit', killOnExit);
  proc.once('exit', () => {
    process.removeListener('exit', killOnExit);
  });

  return {
    url,
    async close() {
      killProcess(proc, 'SIGTERM');
      await waitForExit(proc, 2000).catch((error) => {
        consola.warn('Timeout waiting for opencode server to exit after SIGTERM. Sending SIGKILL', error);
      });

      if (proc.exitCode === null) killProcess(proc, 'SIGKILL');
      await waitForExit(proc, 2000).catch((error) => {
        consola.warn('Timeout waiting for opencode server to exit after SIGKILL', error);
      });
    },
  };
}

function waitForExit(proc: ReturnType<typeof spawn>, timeoutMs: number) {
  if (proc.exitCode !== null) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;

      if (timer) clearTimeout(timer);
      proc.removeListener('exit', onExit);
      fn();
    };

    const onExit = () => settle(resolve);
    proc.once('exit', onExit);

    timer = setTimeout(() => {
      if (proc.exitCode !== null) return settle(resolve);

      if (proc.pid && !isPidAlive(proc.pid)) return settle(resolve);
      settle(() => reject(new Error('Timeout waiting for process exit')));
    }, timeoutMs);

    // Handle race: the process can exit between the `exitCode` check and listener wiring.
    if (proc.exitCode !== null) settle(resolve);
  });
}

function isPidAlive(pid: number) {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? error.code : undefined;

    return code !== 'ESRCH';
  }
}

function killProcess(proc: ReturnType<typeof spawn>, signal: NodeJS.Signals) {
  if (proc.exitCode !== null) return;
  const pid = proc.pid;

  if (!pid) return;

  try {
    if (process.platform !== 'win32') {
      // If spawned with `detached: true`, kill the entire process group.
      process.kill(-pid, signal);

      return;
    }
  } catch {
    // fall through to per-process kill
  }

  try {
    proc.kill(signal);
  } catch {
    // ignore
  }
}

async function waitForHealth(url: string, timeoutMs: number, proc?: ReturnType<typeof spawn>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    while (!controller.signal.aborted) {
      if (proc && proc.exitCode !== null) {
        throw new Error(`opencode server exited with code ${proc.exitCode}`);
      }

      const ok = await fetch(`${url}/global/health`, { signal: controller.signal })
        .then((r) => r.ok)
        .catch(() => false);

      if (ok) return;
      await sleep(100, controller.signal);
    }

    throw new Error(`Timeout waiting for opencode server health after ${timeoutMs}ms (${url})`);
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      clearTimeout(t);
      cleanup();
      resolve();
    };

    const t = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function pickPort(preferred?: number) {
  if (preferred && (await isPortFree(preferred))) return preferred;

  return await new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();

      if (!addr || typeof addr === 'string') return reject(new Error('Failed to allocate a port'));
      const port = addr.port;
      srv.close(() => resolve(port));
    });
  });
}

function isPortFree(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(true));
  });
}

function looksLikePortConflict(cause: unknown) {
  const msg = cause instanceof Error ? `${cause.message}\n${cause.stack ?? ''}` : String(cause);

  return /EADDRINUSE|address already in use|listen/i.test(msg);
}

async function prepareIsolatedOpencodeEnv(arenaStateDir: string) {
  // Keep OpenCode config/state deterministic for `spawn` mode by isolating XDG + "home"
  // away from the user's machine config. Store it under `.agent-arena/` by default.
  const root = path.join(arenaStateDir, 'opencode');

  const xdg = {
    XDG_CONFIG_HOME: path.join(root, 'xdg', 'config'),
    XDG_CACHE_HOME: path.join(root, 'xdg', 'cache'),
    XDG_STATE_HOME: path.join(root, 'xdg', 'state'),
  } as const;

  const testHome = path.join(root, 'home');
  const opencodeConfigDir = path.join(xdg.XDG_CONFIG_HOME, 'opencode');

  await fs.mkdir(opencodeConfigDir, { recursive: true });
  await fs.mkdir(testHome, { recursive: true });

  // Remove any persisted OpenCode config files that could override OPENCODE_CONFIG_CONTENT.
  // Keep `node_modules/` and other caches intact to avoid repeated installs.
  await Promise.all(
    ['config.json', 'opencode.json', 'opencode.jsonc', 'config'].map((name) =>
      fs.rm(path.join(opencodeConfigDir, name), { force: true }).catch(() => {}),
    ),
  );

  return {
    ...xdg,
    // Keep XDG data (auth tokens) on the user's machine so OpenCode can reuse
    // existing Codex/ChatGPT OAuth credentials (e.g. OpenAI oauth).
    OPENCODE_TEST_HOME: testHome,
  };
}
