import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  linkSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

export function readJson<T>(path: string): T | undefined {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : undefined;
}

export function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 1)}\n`);
}

/**
 * A row is committed once its newline is written. A crash mid-append leaves a torn last line without
 * one, which readers leave out and `repairTail` cuts before the next writer appends.
 */
export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  return text
    .slice(0, text.lastIndexOf('\n') + 1)
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

/** Cut a torn last line, so the next row starts on a line of its own. */
export function repairTail(path: string) {
  if (!existsSync(path)) return;
  const { size } = statSync(path);
  if (!size) return;
  const last = Buffer.alloc(1);
  const file = openSync(path, 'r');
  try {
    readSync(file, last, 0, 1, size - 1);
  } finally {
    closeSync(file);
  }
  if (last[0] !== 0x0a) truncateSync(path, readFileSync(path).lastIndexOf(0x0a) + 1);
}

/** Rows land as each run finishes, so a crash keeps every finished run. */
export function appendJsonl(path: string, row: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(row)}\n`);
}

/** Replace a results file in one rename, so a reader sees the old rows or the new ones. */
export function writeJsonl(path: string, rows: readonly unknown[]) {
  const staged = `${path}.next`;
  writeFileSync(staged, rows.map((row) => `${JSON.stringify(row)}\n`).join(''));
  renameSync(staged, path);
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const code = (error: unknown) => (error as NodeJS.ErrnoException).code;

/** The pid a lock names, or undefined when the lock is gone. Unreadable content names no live process. */
function holderOf(path: string): number | undefined {
  try {
    const pid = Number(readFileSync(path, 'utf8'));
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  } catch (error) {
    if (code(error) === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * Hold `path` for this process until the returned release runs. A lock whose process has exited
 * passes to the next holder, and a live holder is reported by pid.
 */
export function holdLock(path: string, what: string): () => void {
  mkdirSync(dirname(path), { recursive: true });
  const mine = String(process.pid);
  // The lock appears with its pid already written, so a reader never sees it half made.
  const staged = `${path}.${process.pid}`;
  writeFileSync(staged, mine);
  try {
    for (;;) {
      try {
        linkSync(staged, path);
        return () => {
          if (holderOf(path) === process.pid) rmSync(path, { force: true });
        };
      } catch (error) {
        if (code(error) !== 'EEXIST') throw error;
      }
      const holder = holderOf(path);
      if (holder === undefined) continue;
      if (holder && alive(holder))
        throw new Error(`${what} is in use by process ${holder}. Delete ${path} if no eval runs.`);
      // Move the stale lock aside, so only one process removes it. A lock that changed hands meanwhile
      // goes back unless another holder already took its place.
      const aside = `${path}.${process.pid}.stale`;
      try {
        renameSync(path, aside);
      } catch (error) {
        if (code(error) === 'ENOENT') continue;
        throw error;
      }
      if (holderOf(aside) !== holder) {
        try {
          linkSync(aside, path);
        } catch (error) {
          if (code(error) !== 'EEXIST') throw error;
        }
      }
      rmSync(aside, { force: true });
    }
  } finally {
    rmSync(staged, { force: true });
  }
}
