import { Chat, type UIMessage } from '@ai-sdk/react';
import type { VacpLLMConfig } from '@vacp/agent-client';

type VacpChatSessionEntry = {
  cacheKey: string;
  chat: Chat<UIMessage>;
  createdAtMs: number;
  usedAtMs: number;
};

type CreateSessionArgs = {
  cacheKey: string;
  id: string;
  messages: UIMessage[];
  transport: unknown;
};

const MAX_SESSIONS = 120;
const registry = new Map<string, VacpChatSessionEntry>();

function touch(entry: VacpChatSessionEntry): VacpChatSessionEntry {
  entry.usedAtMs = Date.now();
  return entry;
}

function pruneSessions() {
  if (registry.size <= MAX_SESSIONS) return;
  const oldest = [...registry.values()].sort((a, b) => a.usedAtMs - b.usedAtMs).slice(0, registry.size - MAX_SESSIONS);
  for (const entry of oldest) registry.delete(entry.cacheKey);
}

export function createVacpChatSessionCacheKey(args: {
  scopeId: string;
  threadId: string;
  runtimeId: string | undefined;
  config: VacpLLMConfig;
}): string {
  return [
    args.scopeId,
    args.threadId,
    args.runtimeId ?? 'unknown-runtime',
    args.config.provider,
    args.config.providerName.trim(),
    args.config.baseURL.trim(),
    args.config.model.trim(),
    String(args.config.maxSteps ?? 6),
    String(args.config.maxOutputTokens ?? ''),
    String(args.config.temperature ?? 0.2),
  ].join('::');
}

export function getOrCreateVacpChatSession(args: CreateSessionArgs): Chat<UIMessage> {
  const cached = registry.get(args.cacheKey);
  if (cached) return touch(cached).chat;

  const chat = new Chat<UIMessage>({
    id: args.id,
    messages: args.messages,
    transport: args.transport as never,
  });
  const entry: VacpChatSessionEntry = {
    cacheKey: args.cacheKey,
    chat,
    createdAtMs: Date.now(),
    usedAtMs: Date.now(),
  };
  registry.set(args.cacheKey, entry);
  pruneSessions();
  return chat;
}

export function clearVacpChatSession(cacheKey: string) {
  const cached = registry.get(cacheKey);
  if (!cached) return;
  cached.chat.messages = [];
  cached.chat.clearError();
}

export function deleteVacpChatSession(cacheKey: string) {
  registry.delete(cacheKey);
}

export function deleteVacpChatSessionsForScope(scopeId: string) {
  for (const key of registry.keys()) {
    if (key.startsWith(`${scopeId}::`)) registry.delete(key);
  }
}
