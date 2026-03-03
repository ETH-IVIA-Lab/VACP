import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type OpencodeStorageRoot = {
  // Absolute path to the storage directory containing `message/`, `part/`, `session/`, etc.
  storageDir: string;
};

export type OpencodeMessageInfo = {
  id: string;
  sessionID: string;
  role: string;
  errorName?: string;
  errorMessage?: string;
  timeCreated?: number;
  timeCompleted?: number;
  cost?: number;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
};

export type OpencodePart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: string;
  tool?: string;
  callID?: string;
  reason?: string;
  text?: string;
  state?: any;
  time?: { start?: number; end?: number };
};

export async function resolveOpencodeStorageRoot(args?: {
  opencodeRoot?: string;
  sessionIDs?: string[];
}): Promise<OpencodeStorageRoot> {
  const raw = args?.opencodeRoot?.trim();
  const candidates: string[] = [];
  const sessionIDs = unique(
    (args?.sessionIDs ?? []).filter((v) => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim()),
  );

  if (raw) {
    const expanded = expandHome(raw);
    candidates.push(expanded);
    candidates.push(path.join(expanded, 'storage'));
  } else {
    const env = process.env.OPENCODE_STORAGE_DIR || process.env.OPENCODE_STORAGE || process.env.OPENCODE_HOME;
    if (env) {
      const expanded = expandHome(String(env));
      candidates.push(expanded);
      candidates.push(path.join(expanded, 'storage'));
    }
    candidates.push(path.join(os.homedir(), '.local', 'share', 'opencode', 'storage'));
    candidates.push(path.join(os.homedir(), '.opencode', 'storage'));
    candidates.push(path.join(os.homedir(), 'Library', 'Application Support', 'opencode', 'storage'));
  }

  let fallback: string | null = null;
  for (const candidate of unique(candidates)) {
    if (!(await looksLikeStorageDir(candidate))) continue;
    fallback ??= candidate;
    if (sessionIDs.length > 0 && !(await storageHasAnySessions(candidate, sessionIDs))) continue;
    return { storageDir: candidate };
  }

  if (fallback) return { storageDir: fallback };

  throw new Error(
    [
      `Failed to locate OpenCode storage directory.`,
      `Tried:`,
      ...unique(candidates).map((p) => `- ${p}`),
      ``,
      `Pass --opencode-root to agent-arena analyze (either the storage dir itself, or the parent that contains a storage/ folder).`,
    ].join('\n'),
  );
}

export async function readSessionMessages(
  storage: OpencodeStorageRoot,
  sessionID: string,
): Promise<OpencodeMessageInfo[]> {
  const dir = path.join(storage.storageDir, 'message', sessionID);
  const entries = await safeReaddir(dir);
  const jsonFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => path.join(dir, e.name));

  const out: OpencodeMessageInfo[] = [];
  for (const filePath of jsonFiles) {
    const parsed = await readJsonOrNull(filePath);
    if (!parsed || typeof parsed !== 'object') continue;
    const id = typeof (parsed as any).id === 'string' ? String((parsed as any).id) : '';
    const sid = typeof (parsed as any).sessionID === 'string' ? String((parsed as any).sessionID) : sessionID;
    const role = typeof (parsed as any).role === 'string' ? String((parsed as any).role) : '';
    if (!id || !role) continue;
    const time = (parsed as any).time ?? {};
    const error = (parsed as any).error ?? {};
    const errorData = typeof error?.data === 'object' && error?.data ? error.data : {};
    const errorMessageRaw = errorData?.message ?? error?.message;
    out.push({
      id,
      sessionID: sid,
      role,
      ...(typeof error?.name === 'string' ? { errorName: String(error.name) } : {}),
      ...(typeof errorMessageRaw === 'string' ? { errorMessage: String(errorMessageRaw) } : {}),
      ...(typeof time.created === 'number' ? { timeCreated: time.created } : {}),
      ...(typeof time.completed === 'number' ? { timeCompleted: time.completed } : {}),
      ...(typeof (parsed as any).cost === 'number' ? { cost: (parsed as any).cost } : {}),
      ...(typeof (parsed as any).tokens === 'object' && (parsed as any).tokens
        ? { tokens: (parsed as any).tokens }
        : {}),
    });
  }

  out.sort((a, b) => (a.timeCreated ?? 0) - (b.timeCreated ?? 0));
  return out;
}

export async function readMessageParts(storage: OpencodeStorageRoot, messageID: string): Promise<OpencodePart[]> {
  const dir = path.join(storage.storageDir, 'part', messageID);
  const entries = await safeReaddir(dir);
  const jsonFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => path.join(dir, e.name));

  const out: OpencodePart[] = [];
  for (const filePath of jsonFiles) {
    const parsed = await readJsonOrNull(filePath);
    if (!parsed || typeof parsed !== 'object') continue;
    const id = typeof (parsed as any).id === 'string' ? String((parsed as any).id) : '';
    const sessionID = typeof (parsed as any).sessionID === 'string' ? String((parsed as any).sessionID) : '';
    const msg = typeof (parsed as any).messageID === 'string' ? String((parsed as any).messageID) : messageID;
    const type = typeof (parsed as any).type === 'string' ? String((parsed as any).type) : '';
    if (!id || !msg || !type) continue;
    out.push({
      id,
      sessionID,
      messageID: msg,
      type,
      ...(typeof (parsed as any).tool === 'string' ? { tool: String((parsed as any).tool) } : {}),
      ...(typeof (parsed as any).callID === 'string' ? { callID: String((parsed as any).callID) } : {}),
      ...(typeof (parsed as any).reason === 'string' ? { reason: String((parsed as any).reason) } : {}),
      ...(typeof (parsed as any).text === 'string' ? { text: String((parsed as any).text) } : {}),
      ...(typeof (parsed as any).state === 'object' && (parsed as any).state ? { state: (parsed as any).state } : {}),
      ...(typeof (parsed as any).time === 'object' && (parsed as any).time ? { time: (parsed as any).time } : {}),
    });
  }

  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

export function relPathFromStorage(storage: OpencodeStorageRoot, absolutePath: string) {
  return path.relative(storage.storageDir, absolutePath);
}

async function looksLikeStorageDir(candidate: string) {
  const messageDir = path.join(candidate, 'message');
  const partDir = path.join(candidate, 'part');
  return (await isDirectory(messageDir)) && (await isDirectory(partDir));
}

async function storageHasAnySessions(storageDir: string, sessionIDs: string[]) {
  for (const sessionID of sessionIDs) {
    const dir = path.join(storageDir, 'message', sessionID);
    if (await isDirectory(dir)) return true;
  }
  return false;
}

async function isDirectory(p: string) {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function safeReaddir(p: string) {
  try {
    return await fs.readdir(p, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function readJsonOrNull(filePath: string) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function expandHome(p: string) {
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}
