import { Chat } from '@ai-sdk/react';
import type { VacpChatMessage as UIMessage } from '@vacp/agent-ai-sdk';
import type { VacpLLMConfig } from '@vacp/agent-ai-sdk';

import { messageSyncSignature } from './message-sync-signature';

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
  transport: ConstructorParameters<typeof Chat<UIMessage>>[0]['transport'];
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
  sessionRevision?: number;
  credentialRevision?: number;
  runtimeId: string | undefined;
  config: VacpLLMConfig;
}): string {
  return [
    args.scopeId,
    args.threadId,
    String(args.sessionRevision ?? 0),
    String(args.credentialRevision ?? 0),
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

  if (cached) {
    if (messageSyncSignature(cached.chat.messages) !== messageSyncSignature(args.messages)) {
      cached.chat.messages = args.messages;
      cached.chat.clearError();
    }

    return touch(cached).chat;
  }

  const chat = new Chat<UIMessage>({
    id: args.id,
    messages: args.messages,
    transport: args.transport,
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

export function deleteVacpChatSession(cacheKey: string) {
  registry.delete(cacheKey);
}
