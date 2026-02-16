import fs from 'node:fs/promises';
import path from 'node:path';
import { consola } from 'consola';
import { createClient } from '../opencode.js';

// --- I/O ---------------------------------------------------------------

export async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export function requireData<T>(result: { data?: T; error?: unknown }): T {
  if ('error' in result && result.error) throw result.error;
  if (!('data' in result) || result.data === undefined) {
    throw new Error('Missing response data');
  }
  return result.data;
}

export function toErrorPayload(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: error.message, stack: error.stack };
  return { message: String(error) };
}

export function portablePathWithin(rootDir: string, absPath: string) {
  const root = path.resolve(rootDir);
  const target = path.resolve(absPath);
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return target;
  return rel;
}

// --- Timeouts ----------------------------------------------------------

export class TimeoutError extends Error {
  override name = 'TimeoutError';
  constructor(message: string) {
    super(message);
  }
}

export async function withTimeout<T>(timeoutMs: number, label: string, fn: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  const timeoutError = new TimeoutError(`${label} timed out after ${timeoutMs}ms`);
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  (timer as any).unref?.();

  try {
    const timeoutPromise = new Promise<T>((_, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => {
          reject(timeoutError);
        },
        { once: true },
      );
    });
    return await Promise.race([fn(controller.signal), timeoutPromise]);
  } catch (error) {
    if (controller.signal.aborted) throw timeoutError;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function sleep(ms: number, signal?: AbortSignal) {
  return sleepImpl(ms, signal, false);
}

export function sleepUnref(ms: number, signal?: AbortSignal) {
  return sleepImpl(ms, signal, true);
}

function sleepImpl(ms: number, signal: AbortSignal | undefined, unref: boolean) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    if (unref) (timer as any).unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// --- Auto-approve permission requests ---------------------------------

export function startAutoApprove(args: {
  client: ReturnType<typeof createClient>;
  directory: string;
  mode: 'off' | 'once' | 'always' | 'reject' | undefined;
  signal: AbortSignal;
}) {
  if (!args.mode || args.mode === 'off') return Promise.resolve();

  return (async () => {
    const replied = new Set<string>();
    const reply = args.mode === 'reject' ? 'reject' : args.mode === 'always' ? 'always' : 'once';
    while (!args.signal.aborted) {
      const pending = await withAbortTimeout(
        args.signal,
        2000,
        'permission.list',
        (signal) => args.client.permission.list({ directory: args.directory }, { signal }),
        undefined,
      );
      const requests = pending ? requireData(pending) : [];
      for (const req of requests as Array<{ id: string }>) {
        if (!req?.id || replied.has(req.id)) continue;
        replied.add(req.id);
        await withAbortTimeout(
          args.signal,
          2000,
          'permission.reply',
          (signal) => args.client.permission.reply({ directory: args.directory, requestID: req.id, reply }, { signal }),
          undefined,
        );
      }
      await sleepUnref(300, args.signal);
    }
  })();
}

export function startAutoRejectQuestions(args: {
  client: ReturnType<typeof createClient>;
  directory: string;
  enabled: boolean;
  signal: AbortSignal;
}) {
  if (!args.enabled) return Promise.resolve();

  return (async () => {
    const handled = new Set<string>();
    while (!args.signal.aborted) {
      const pending = await withAbortTimeout(
        args.signal,
        2000,
        'question.list',
        (signal) => args.client.question.list({ directory: args.directory }, { signal }),
        undefined,
      );
      const requests = pending ? requireData(pending) : [];
      for (const req of requests as Array<{ id: string }>) {
        if (!req?.id || handled.has(req.id)) continue;
        handled.add(req.id);
        await withAbortTimeout(
          args.signal,
          2000,
          'question.reject',
          (signal) => args.client.question.reject({ directory: args.directory, requestID: req.id }, { signal }),
          undefined,
        );
      }
      await sleepUnref(300, args.signal);
    }
  })();
}

async function withAbortTimeout<T>(
  parentSignal: AbortSignal,
  timeoutMs: number,
  label: string,
  fn: (signal: AbortSignal) => Promise<T>,
  fallback: T,
): Promise<T> {
  if (parentSignal.aborted) return fallback;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  (timer as any).unref?.();
  const onAbort = () => controller.abort();
  parentSignal.addEventListener('abort', onAbort, { once: true });

  try {
    return await fn(controller.signal);
  } catch (error) {
    if (!parentSignal.aborted) {
      const msg = controller.signal.aborted ? `${label} timed out after ${timeoutMs}ms` : `${label} failed`;
      warnThrottled(label, msg, { error });
    }
    return fallback;
  } finally {
    clearTimeout(timer);
    parentSignal.removeEventListener('abort', onAbort);
  }
}

const warningThrottle = new Map<string, number>();
function warnThrottled(key: string, message: string, meta?: unknown) {
  const now = Date.now();
  const last = warningThrottle.get(key) ?? 0;
  if (now - last < 10_000) return;
  warningThrottle.set(key, now);
  consola.warn(message, meta);
}
