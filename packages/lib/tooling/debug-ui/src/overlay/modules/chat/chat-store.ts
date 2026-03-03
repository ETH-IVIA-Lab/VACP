import { type UIMessage } from '@ai-sdk/react';
import type { VacpAgentToolEvent } from '@vacp/agent-client';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { VacpChatScopeMeta } from './chat-scope';

const STORAGE_KEY = 'vacp:debug:chat:history:v1';
const MAX_SCOPES = 30;
const MAX_THREADS_PER_SCOPE = 20;
const MAX_MESSAGES_PER_THREAD = 200;
const MAX_TOOL_EVENTS_PER_THREAD = 200;

function nowIso(): string {
  return new Date().toISOString();
}

function makeThreadId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `thread:${crypto.randomUUID()}`;
  return `thread:${Math.random().toString(36).slice(2, 10)}`;
}

function threadKey(scopeId: string, threadId: string): string {
  return `${scopeId}::${threadId}`;
}

function firstUserText(messages: UIMessage[]): string | null {
  for (const message of messages) {
    if (message.role !== 'user') continue;
    for (const part of message.parts) {
      if (part.type === 'text' && typeof part.text === 'string') {
        const text = part.text.trim();
        if (text.length) return text;
      }
    }
  }
  return null;
}

function normalizeTitle(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  if (trimmed.length <= 70) return trimmed;
  return `${trimmed.slice(0, 67)}...`;
}

function inferThreadTitle(messages: UIMessage[], fallback = 'New chat'): string {
  const text = firstUserText(messages);
  if (!text) return fallback;
  return normalizeTitle(text, fallback);
}

function messageSyncSignature(messages: UIMessage[]): string {
  return messages
    .map((message) => {
      const partSig = message.parts
        .map((part) => {
          if (part.type === 'text' && typeof part.text === 'string') return `text:${part.text}`;
          if (part.type === 'reasoning' && typeof part.text === 'string') return `reasoning:${part.text}`;
          if ('input' in part || 'output' in part) {
            const input = 'input' in part ? JSON.stringify(part.input ?? null) : '';
            const output = 'output' in part ? JSON.stringify(part.output ?? null) : '';
            const state = 'state' in part ? String(part.state ?? '') : '';
            return `${part.type}:${state}:${input}:${output}`;
          }
          return part.type;
        })
        .join(',');
      const metadataSig = JSON.stringify(message.metadata ?? null);
      return `${message.role}:${metadataSig}:${partSig}`;
    })
    .join('|');
}

function createThread(): VacpChatThread {
  const createdAt = nowIso();
  return {
    id: makeThreadId(),
    title: 'New chat',
    createdAt,
    updatedAt: createdAt,
    messages: [],
    toolEvents: [],
  };
}

function sortThreadOrder(scope: VacpChatScopeState): string[] {
  return scope.threadOrder
    .slice()
    .sort((a, b) => {
      const aTime = scope.threads[a]?.updatedAt ?? '';
      const bTime = scope.threads[b]?.updatedAt ?? '';
      return bTime.localeCompare(aTime);
    })
    .slice(0, MAX_THREADS_PER_SCOPE);
}

function pruneScopeCount(state: VacpChatStoreData): VacpChatStoreData {
  const scopeEntries = Object.entries(state.scopes);
  if (scopeEntries.length <= MAX_SCOPES) return state;

  const ordered = scopeEntries
    .sort((a, b) => a[1].meta.updatedAt.localeCompare(b[1].meta.updatedAt))
    .map(([scopeId]) => scopeId);
  const removeSet = new Set(ordered.slice(0, scopeEntries.length - MAX_SCOPES));
  if (!removeSet.size) return state;

  const scopes: Record<string, VacpChatScopeState> = {};
  for (const [scopeId, scope] of Object.entries(state.scopes)) {
    if (!removeSet.has(scopeId)) scopes[scopeId] = scope;
  }

  const draftByThreadKey: Record<string, string> = {};
  for (const [k, v] of Object.entries(state.draftByThreadKey)) {
    if (!removeSet.has(k.split('::')[0] ?? '')) draftByThreadKey[k] = v;
  }

  const activityOpenByScope: Record<string, boolean> = {};
  for (const [scopeId, open] of Object.entries(state.activityOpenByScope)) {
    if (!removeSet.has(scopeId)) activityOpenByScope[scopeId] = open;
  }

  const settingsOpenByScope: Record<string, boolean> = {};
  for (const [scopeId, open] of Object.entries(state.settingsOpenByScope)) {
    if (!removeSet.has(scopeId)) settingsOpenByScope[scopeId] = open;
  }

  const activeScopeId = state.activeScopeId && removeSet.has(state.activeScopeId) ? null : state.activeScopeId;
  return { ...state, scopes, draftByThreadKey, activityOpenByScope, settingsOpenByScope, activeScopeId };
}

function ensureScopeWithThread(
  scopes: Record<string, VacpChatScopeState>,
  meta: VacpChatScopeMeta,
): VacpChatScopeState {
  const existing = scopes[meta.scopeId];
  if (existing) {
    return {
      ...existing,
      meta: { ...existing.meta, ...meta, updatedAt: nowIso() },
    };
  }
  const thread = createThread();
  return {
    meta: { ...meta, updatedAt: nowIso() },
    activeThreadId: thread.id,
    threadOrder: [thread.id],
    threads: { [thread.id]: thread },
  };
}

export type VacpChatThread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: UIMessage[];
  toolEvents: VacpAgentToolEvent[];
};

export type VacpChatScopeState = {
  meta: VacpChatScopeMeta;
  activeThreadId: string;
  threadOrder: string[];
  threads: Record<string, VacpChatThread>;
};

export type VacpChatStoreData = {
  version: 1;
  activeScopeId: string | null;
  scopes: Record<string, VacpChatScopeState>;
  draftByThreadKey: Record<string, string>;
  activityOpenByScope: Record<string, boolean>;
  settingsOpenByScope: Record<string, boolean>;
};

export type VacpChatStoreState = VacpChatStoreData & {
  ensureScope: (meta: VacpChatScopeMeta) => void;
  createThread: (scopeId: string) => string | null;
  setActiveThread: (scopeId: string, threadId: string) => void;
  setThreadMessages: (scopeId: string, threadId: string, messages: UIMessage[]) => void;
  appendToolEvent: (scopeId: string, threadId: string, event: VacpAgentToolEvent) => void;
  clearThread: (scopeId: string, threadId: string) => void;
  deleteThread: (scopeId: string, threadId: string) => void;
  setDraft: (scopeId: string, threadId: string, value: string) => void;
  setActivityOpen: (scopeId: string, open: boolean) => void;
  setSettingsOpen: (scopeId: string, open: boolean) => void;
};

const initialStoreData: VacpChatStoreData = {
  version: 1,
  activeScopeId: null,
  scopes: {},
  draftByThreadKey: {},
  activityOpenByScope: {},
  settingsOpenByScope: {},
};

export const useVacpChatStore = create<VacpChatStoreState>()(
  persist(
    (set) => ({
      ...initialStoreData,

      ensureScope: (meta) => {
        set((state) => {
          const scope = ensureScopeWithThread(state.scopes, meta);
          const next: VacpChatStoreData = {
            ...state,
            activeScopeId: meta.scopeId,
            scopes: { ...state.scopes, [meta.scopeId]: scope },
          };
          return pruneScopeCount(next);
        });
      },

      createThread: (scopeId) => {
        let createdId: string | null = null;
        set((state) => {
          const scope = state.scopes[scopeId];
          if (!scope) return state;
          const thread = createThread();
          createdId = thread.id;
          const nextScope: VacpChatScopeState = {
            ...scope,
            activeThreadId: thread.id,
            threadOrder: [thread.id, ...scope.threadOrder].slice(0, MAX_THREADS_PER_SCOPE),
            threads: { ...scope.threads, [thread.id]: thread },
            meta: { ...scope.meta, updatedAt: nowIso() },
          };
          return {
            ...state,
            scopes: { ...state.scopes, [scopeId]: nextScope },
            activeScopeId: scopeId,
          };
        });
        return createdId;
      },

      setActiveThread: (scopeId, threadId) => {
        set((state) => {
          const scope = state.scopes[scopeId];
          if (!scope || !scope.threads[threadId]) return state;
          return {
            ...state,
            activeScopeId: scopeId,
            scopes: {
              ...state.scopes,
              [scopeId]: {
                ...scope,
                activeThreadId: threadId,
                meta: { ...scope.meta, updatedAt: nowIso() },
              },
            },
          };
        });
      },

      setThreadMessages: (scopeId, threadId, messages) => {
        set((state) => {
          const scope = state.scopes[scopeId];
          const thread = scope?.threads[threadId];
          if (!scope || !thread) return state;
          const nextMessages = messages.slice(-MAX_MESSAGES_PER_THREAD);
          if (messageSyncSignature(thread.messages) === messageSyncSignature(nextMessages)) return state;
          const nextTitle = inferThreadTitle(nextMessages, thread.title);
          const nextThread: VacpChatThread = {
            ...thread,
            title: nextTitle,
            updatedAt: nowIso(),
            messages: nextMessages,
          };
          const nextScope: VacpChatScopeState = {
            ...scope,
            meta: { ...scope.meta, updatedAt: nowIso() },
            threads: { ...scope.threads, [threadId]: nextThread },
            threadOrder: sortThreadOrder({ ...scope, threads: { ...scope.threads, [threadId]: nextThread } }),
          };
          return { ...state, scopes: { ...state.scopes, [scopeId]: nextScope } };
        });
      },

      appendToolEvent: (scopeId, threadId, event) => {
        set((state) => {
          const scope = state.scopes[scopeId];
          const thread = scope?.threads[threadId];
          if (!scope || !thread) return state;
          const nextThread: VacpChatThread = {
            ...thread,
            updatedAt: nowIso(),
            toolEvents: [...thread.toolEvents.slice(-MAX_TOOL_EVENTS_PER_THREAD + 1), event],
          };
          const nextScope: VacpChatScopeState = {
            ...scope,
            meta: { ...scope.meta, updatedAt: nowIso() },
            threads: { ...scope.threads, [threadId]: nextThread },
            threadOrder: sortThreadOrder({ ...scope, threads: { ...scope.threads, [threadId]: nextThread } }),
          };
          return { ...state, scopes: { ...state.scopes, [scopeId]: nextScope } };
        });
      },

      clearThread: (scopeId, threadId) => {
        set((state) => {
          const scope = state.scopes[scopeId];
          const thread = scope?.threads[threadId];
          if (!scope || !thread) return state;
          const nextThread: VacpChatThread = {
            ...thread,
            title: thread.title || 'New chat',
            updatedAt: nowIso(),
            messages: [],
            toolEvents: [],
          };
          return {
            ...state,
            scopes: {
              ...state.scopes,
              [scopeId]: {
                ...scope,
                meta: { ...scope.meta, updatedAt: nowIso() },
                threads: { ...scope.threads, [threadId]: nextThread },
              },
            },
            draftByThreadKey: { ...state.draftByThreadKey, [threadKey(scopeId, threadId)]: '' },
          };
        });
      },

      deleteThread: (scopeId, threadId) => {
        set((state) => {
          const scope = state.scopes[scopeId];
          if (!scope || !scope.threads[threadId]) return state;

          const threads = { ...scope.threads };
          delete threads[threadId];
          let threadOrder = scope.threadOrder.filter((id) => id !== threadId);

          if (threadOrder.length === 0) {
            const replacement = createThread();
            threads[replacement.id] = replacement;
            threadOrder = [replacement.id];
          }

          const activeThreadId = threadOrder.includes(scope.activeThreadId) ? scope.activeThreadId : threadOrder[0]!;
          const nextScope: VacpChatScopeState = {
            ...scope,
            activeThreadId,
            threadOrder,
            threads,
            meta: { ...scope.meta, updatedAt: nowIso() },
          };

          const draftByThreadKey = { ...state.draftByThreadKey };
          delete draftByThreadKey[threadKey(scopeId, threadId)];

          return {
            ...state,
            scopes: { ...state.scopes, [scopeId]: nextScope },
            draftByThreadKey,
          };
        });
      },

      setDraft: (scopeId, threadId, value) => {
        const key = threadKey(scopeId, threadId);
        set((state) => ({ ...state, draftByThreadKey: { ...state.draftByThreadKey, [key]: value } }));
      },

      setActivityOpen: (scopeId, open) => {
        set((state) => ({ ...state, activityOpenByScope: { ...state.activityOpenByScope, [scopeId]: open } }));
      },

      setSettingsOpen: (scopeId, open) => {
        set((state) => ({ ...state, settingsOpenByScope: { ...state.settingsOpenByScope, [scopeId]: open } }));
      },
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): VacpChatStoreData => ({
        version: 1,
        activeScopeId: state.activeScopeId,
        scopes: state.scopes,
        draftByThreadKey: state.draftByThreadKey,
        activityOpenByScope: state.activityOpenByScope,
        settingsOpenByScope: state.settingsOpenByScope,
      }),
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<VacpChatStoreData>),
      }),
    },
  ),
);

export function readThreadDraft(state: VacpChatStoreState, scopeId: string, threadId: string): string {
  return state.draftByThreadKey[threadKey(scopeId, threadId)] ?? '';
}
