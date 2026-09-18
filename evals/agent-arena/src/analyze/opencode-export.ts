import { isRecord, recordOrEmpty } from '../records.js';

import fs from 'node:fs/promises';
import path from 'node:path';

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

export type JobOpencodeExport = {
  messages: OpencodeMessageInfo[];
  partsByMessageID: Map<string, OpencodePart[]>;
  paths: {
    messages: string;
    session: string;
    toolCalls: string;
  };
  counts: {
    messages: number;
    parts: number;
  };
};

export function emptyJobOpencodeExport(jobDirAbs: string): JobOpencodeExport {
  return {
    messages: [],
    partsByMessageID: new Map(),
    paths: {
      messages: path.join(jobDirAbs, 'messages.json'),
      session: path.join(jobDirAbs, 'session.json'),
      toolCalls: path.join(jobDirAbs, 'tool_calls.json'),
    },
    counts: {
      messages: 0,
      parts: 0,
    },
  };
}

export async function readJobOpencodeExport(args: {
  jobDirAbs: string;
  sessionID: string;
}): Promise<JobOpencodeExport> {
  const paths = {
    messages: path.join(args.jobDirAbs, 'messages.json'),
    session: path.join(args.jobDirAbs, 'session.json'),
    toolCalls: path.join(args.jobDirAbs, 'tool_calls.json'),
  };

  const raw = await readJsonOrThrow(
    paths.messages,
    [
      `Missing OpenCode messages export for session ${args.sessionID}.`,
      `Run or resume the arena with --export-logs so analysis reads the current @opencode-ai/sdk/v2 session export.`,
    ].join('\n'),
  );

  if (!Array.isArray(raw)) {
    throw new Error(`Expected OpenCode messages export to be a JSON array: ${paths.messages}`);
  }

  const messages: OpencodeMessageInfo[] = [];
  const partsByMessageID = new Map<string, OpencodePart[]>();
  let partCount = 0;

  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      throw new Error(`Invalid OpenCode message export entry in ${paths.messages}`);
    }

    const info = (item as any).info;
    const parts = (item as any).parts;
    const message = normalizeMessageInfo(info, args.sessionID, paths.messages);
    const normalizedParts = normalizeParts(parts, message, paths.messages);
    messages.push(message);
    partsByMessageID.set(message.id, normalizedParts);
    partCount += normalizedParts.length;
  }

  messages.sort((a, b) => (a.timeCreated ?? 0) - (b.timeCreated ?? 0));

  return {
    messages,
    partsByMessageID,
    paths,
    counts: {
      messages: messages.length,
      parts: partCount,
    },
  };
}

async function readJsonOrThrow(filePath: string, message: string) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');

    return JSON.parse(raw) as unknown;
  } catch (error) {
    if (isErrno(error) && error.code === 'ENOENT') {
      throw new Error(`${message}\nExpected file: ${filePath}`);
    }

    throw new Error(
      `Failed to read OpenCode messages export: ${filePath}\n${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function normalizeMessageInfo(info: unknown, expectedSessionID: string, sourcePath: string): OpencodeMessageInfo {
  if (!isRecord(info)) {
    throw new Error(`Invalid OpenCode message info in ${sourcePath}`);
  }

  const raw = info;
  const id = typeof raw.id === 'string' ? String(raw.id) : '';
  const sessionID = typeof raw.sessionID === 'string' ? String(raw.sessionID) : '';
  const role = typeof raw.role === 'string' ? String(raw.role) : '';

  if (!id || !sessionID || !role) {
    throw new Error(`OpenCode message info is missing id, sessionID, or role in ${sourcePath}`);
  }

  if (sessionID !== expectedSessionID) {
    throw new Error(`OpenCode message ${id} belongs to ${sessionID}, expected ${expectedSessionID} in ${sourcePath}`);
  }

  const time = recordOrEmpty(raw.time);
  const error = recordOrEmpty(raw.error);
  const errorData = recordOrEmpty(error.data);
  const errorMessageRaw = errorData?.message ?? error?.message;

  return {
    id,
    sessionID,
    role,
    ...(typeof error?.name === 'string' ? { errorName: String(error.name) } : {}),
    ...(typeof errorMessageRaw === 'string' ? { errorMessage: String(errorMessageRaw) } : {}),
    ...(typeof time.created === 'number' ? { timeCreated: time.created } : {}),
    ...(typeof time.completed === 'number' ? { timeCompleted: time.completed } : {}),
    ...(typeof raw.cost === 'number' ? { cost: raw.cost } : {}),
    ...(typeof raw.tokens === 'object' && raw.tokens ? { tokens: raw.tokens } : {}),
  };
}

function normalizeParts(parts: unknown, message: OpencodeMessageInfo, sourcePath: string) {
  if (!Array.isArray(parts)) {
    throw new Error(`OpenCode message ${message.id} has no parts array in ${sourcePath}`);
  }

  return parts.map((part) => normalizePart(part, message, sourcePath));
}

function normalizePart(part: unknown, message: OpencodeMessageInfo, sourcePath: string): OpencodePart {
  if (!isRecord(part)) {
    throw new Error(`Invalid OpenCode message part for ${message.id} in ${sourcePath}`);
  }

  const raw = part;
  const id = typeof raw.id === 'string' ? String(raw.id) : '';
  const messageID = typeof raw.messageID === 'string' ? String(raw.messageID) : '';
  const sessionID = typeof raw.sessionID === 'string' ? String(raw.sessionID) : '';
  const type = typeof raw.type === 'string' ? String(raw.type) : '';

  if (!id || !sessionID || !messageID || !type) {
    throw new Error(`OpenCode part is missing id, sessionID, messageID, or type for ${message.id} in ${sourcePath}`);
  }

  if (sessionID !== message.sessionID || messageID !== message.id) {
    throw new Error(`OpenCode part ${id} does not belong to message ${message.id} in ${sourcePath}`);
  }

  return {
    ...raw,
    id,
    sessionID,
    messageID,
    type,
  } as OpencodePart;
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}
