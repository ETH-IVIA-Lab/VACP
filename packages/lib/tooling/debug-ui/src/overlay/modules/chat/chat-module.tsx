import type { UIMessage } from '@ai-sdk/react';
import {
  clearVacpLLMConfig,
  defaultVacpLLMConfigForProvider,
  listVacpLLMModels,
  loadVacpLLMActiveProvider,
  loadVacpLLMConfig,
  saveVacpLLMConfig,
  saveVacpLLMActiveProvider,
  type VacpAgentToolEvent,
  type VacpLLMConfig,
  type VacpLLMModelOption,
} from '@vacp/agent-client';
import { History, MessageSquarePlus, MoreHorizontal, Settings2, Trash2 } from 'lucide-react';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useElementSize } from '@vacp/debug-ui/overlay/hooks/use-element-size';
import { Button } from '@vacp/debug-ui/ui/components/ui/button';
import { cn } from '@vacp/debug-ui/ui/lib/utils';

import type { VacpDebugModuleProps } from '../module-types';
import { ChatConfigPanel } from './chat-config-panel';
import { ConfiguredChat } from './configured-chat';
import { createVacpChatSessionCacheKey, deleteVacpChatSession } from './chat-session-registry';
import { deriveVacpChatScope } from './chat-scope';
import { readThreadDraft, useVacpChatStore } from './chat-store';

const DEFAULT_CONFIG: VacpLLMConfig = defaultVacpLLMConfigForProvider('openai-compatible');

function isConfigReady(config: VacpLLMConfig): boolean {
  const baseFieldsReady = Boolean(config.apiKey.trim() && config.model.trim());
  if (!baseFieldsReady) return false;
  if (config.provider === 'gemini') return true;
  return Boolean(config.providerName.trim() && config.baseURL.trim());
}

function canListModels(config: VacpLLMConfig): boolean {
  if (!config.apiKey.trim()) return false;
  if (config.provider === 'gemini') return true;
  return Boolean(config.baseURL.trim() && config.providerName.trim());
}

function threadSubtitle(messages: UIMessage[]): string {
  if (messages.length === 0) return 'Empty';
  const last = messages[messages.length - 1];
  const role = last.role === 'assistant' ? 'Agent' : last.role === 'user' ? 'You' : 'System';
  return `${messages.length} message${messages.length === 1 ? '' : 's'} • last: ${role}`;
}

export function ChatModule(props: VacpDebugModuleProps): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rootSize = useElementSize(rootRef);
  const wide = rootSize.width >= 960;
  const compactActions = rootSize.width < 860;

  const initialConfig = useMemo(() => {
    const activeProvider = loadVacpLLMActiveProvider() ?? DEFAULT_CONFIG.provider;
    return loadVacpLLMConfig(activeProvider) ?? defaultVacpLLMConfigForProvider(activeProvider);
  }, []);
  const [config, setConfig] = useState<VacpLLMConfig>(initialConfig);
  const [showApiKey, setShowApiKey] = useState(false);
  const [threadPickerOpen, setThreadPickerOpen] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [availableModels, setAvailableModels] = useState<VacpLLMModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelRefreshSeq, setModelRefreshSeq] = useState(0);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);

  const ensureScope = useVacpChatStore((s) => s.ensureScope);
  const createThread = useVacpChatStore((s) => s.createThread);
  const clearThread = useVacpChatStore((s) => s.clearThread);
  const setActiveThread = useVacpChatStore((s) => s.setActiveThread);
  const setThreadMessages = useVacpChatStore((s) => s.setThreadMessages);
  const appendToolEvent = useVacpChatStore((s) => s.appendToolEvent);
  const setDraft = useVacpChatStore((s) => s.setDraft);
  const setActivityOpen = useVacpChatStore((s) => s.setActivityOpen);
  const setSettingsOpen = useVacpChatStore((s) => s.setSettingsOpen);

  const scopeMeta = useMemo(() => deriveVacpChatScope(props.runtime), [props.runtime]);
  const scopeId = scopeMeta.scopeId;
  const scope = useVacpChatStore((s) => s.scopes[scopeId]);
  const showActivity = useVacpChatStore((s) => s.activityOpenByScope[scopeId] ?? false);
  const settingsOpen = useVacpChatStore((s) => s.settingsOpenByScope[scopeId] ?? false);
  const activeThreadId = scope?.activeThreadId ?? null;
  const activeThread = activeThreadId ? (scope?.threads[activeThreadId] ?? null) : null;
  const draft = useVacpChatStore((s) => {
    const threadId = s.scopes[scopeId]?.activeThreadId;
    if (!threadId) return '';
    return readThreadDraft(s, scopeId, threadId);
  });

  useEffect(() => {
    saveVacpLLMConfig(config);
  }, [config]);

  const switchProvider = useCallback(
    (nextProvider: VacpLLMConfig['provider']) => {
      if (nextProvider === config.provider) return;
      saveVacpLLMConfig(config);
      saveVacpLLMActiveProvider(nextProvider);
      const nextConfig = loadVacpLLMConfig(nextProvider) ?? defaultVacpLLMConfigForProvider(nextProvider);
      setConfig(nextConfig);
      setAvailableModels([]);
      setModelsError(null);
      setModelsLoading(false);
    },
    [config],
  );

  useEffect(() => {
    ensureScope(scopeMeta);
  }, [ensureScope, scopeMeta]);

  const configReady = isConfigReady(config);
  const modelLookupKey = useMemo(
    () => [config.provider, config.providerName.trim(), config.baseURL.trim(), config.apiKey.trim()].join('::'),
    [config.provider, config.providerName, config.baseURL, config.apiKey],
  );
  const [debouncedModelLookupKey, setDebouncedModelLookupKey] = useState(modelLookupKey);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedModelLookupKey(modelLookupKey), 320);
    return () => window.clearTimeout(timer);
  }, [modelLookupKey]);

  useEffect(() => {
    if (!settingsOpen) return;
    if (modelRefreshSeq === 0) {
      setModelsLoading(false);
      setModelsError(null);
      return;
    }
    if (debouncedModelLookupKey !== modelLookupKey) return;
    if (!canListModels(config)) {
      setAvailableModels([]);
      setModelsError(null);
      setModelsLoading(false);
      return;
    }

    const abortController = new AbortController();
    setModelsLoading(true);
    setModelsError(null);

    void listVacpLLMModels(config, { signal: abortController.signal })
      .then((models) => {
        if (abortController.signal.aborted) return;
        setAvailableModels(models);
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) return;
        setAvailableModels([]);
        setModelsError(error instanceof Error ? error.message : 'Unable to load models');
      })
      .finally(() => {
        if (!abortController.signal.aborted) setModelsLoading(false);
      });

    return () => abortController.abort();
  }, [config, debouncedModelLookupKey, modelLookupKey, modelRefreshSeq, settingsOpen]);

  useEffect(() => {
    setThreadPickerOpen(false);
    setActionsMenuOpen(false);
  }, [scopeId]);

  useEffect(() => {
    if (!compactActions) setActionsMenuOpen(false);
  }, [compactActions]);

  useEffect(() => {
    if (!actionsMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const menuNode = actionsMenuRef.current;
      if (!menuNode) return;
      if (event.target instanceof Node && !menuNode.contains(event.target)) setActionsMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActionsMenuOpen(false);
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [actionsMenuOpen]);

  const threadItems = useMemo(() => {
    if (!scope) return [];
    return scope.threadOrder
      .map((id) => scope.threads[id])
      .filter((thread): thread is NonNullable<typeof thread> => Boolean(thread));
  }, [scope]);

  const onToolEvent = useCallback(
    (event: VacpAgentToolEvent) => {
      if (!activeThreadId) return;
      appendToolEvent(scopeId, activeThreadId, event);
    },
    [activeThreadId, appendToolEvent, scopeId],
  );

  const sessionCacheKey = useMemo(() => {
    if (!activeThreadId) return null;
    return createVacpChatSessionCacheKey({
      scopeId,
      threadId: activeThreadId,
      sessionRevision: activeThread?.sessionRevision ?? 0,
      runtimeId: props.runtime.runtimeId,
      config,
    });
  }, [scopeId, activeThreadId, activeThread?.sessionRevision, props.runtime.runtimeId, config]);

  const sidePanelOpen = settingsOpen || threadPickerOpen;
  const sidePanelWide = rootSize.width >= 860;

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-col gap-3 border-b border-white/[0.075] pb-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase text-slate-100/70">Chat</div>
          <div className="mt-1 text-pretty text-[12px] text-slate-100/70">
            {scopeMeta.label} • ask questions, run actions, and inspect tool traces.
          </div>
        </div>
        <div data-vacp-chat-actions="1" className="flex max-w-full flex-wrap items-center gap-2 sm:justify-end">
          <Button
            size="sm"
            className="shrink-0"
            data-vacp-chat-thread-trigger="1"
            aria-label="Open chat history"
            title="Open chat history"
            aria-pressed={threadPickerOpen}
            onClick={() => {
              setThreadPickerOpen((v) => {
                const next = !v;
                if (next) setSettingsOpen(scopeId, false);
                return next;
              });
              setActionsMenuOpen(false);
            }}
          >
            <History className="h-4 w-4 text-slate-100/90" />
            History
          </Button>
          <Button
            size="sm"
            className="shrink-0"
            data-vacp-chat-new-thread="1"
            aria-label="New chat"
            title="Start a new chat thread"
            onClick={() => {
              const nextId = createThread(scopeId);
              if (nextId) setActiveThread(scopeId, nextId);
              setThreadPickerOpen(false);
              setActionsMenuOpen(false);
            }}
          >
            <MessageSquarePlus className="h-4 w-4 text-slate-100/90" />
            New
          </Button>
          <Button
            size="sm"
            className="shrink-0"
            data-vacp-chat-clear-thread="1"
            aria-label="Clear active thread"
            title="Clear active thread"
            disabled={!activeThreadId}
            onClick={() => {
              if (!activeThreadId || !sessionCacheKey) return;
              deleteVacpChatSession(sessionCacheKey);
              clearThread(scopeId, activeThreadId);
              setActionsMenuOpen(false);
            }}
          >
            <Trash2 className="h-4 w-4 text-slate-100/90" />
            Clear
          </Button>

          {compactActions ? (
            <div ref={actionsMenuRef} className="relative shrink-0">
              <Button
                size="sm"
                className="shrink-0"
                data-vacp-chat-actions-more="1"
                aria-label="More chat actions"
                title="More chat actions"
                aria-expanded={actionsMenuOpen}
                onClick={() => setActionsMenuOpen((v) => !v)}
              >
                <MoreHorizontal className="h-4 w-4 text-slate-100/90" />
                More
              </Button>
              {actionsMenuOpen ? (
                <div
                  data-vacp-chat-actions-menu="1"
                  className="absolute right-0 top-9 z-30 grid min-w-[152px] gap-1 rounded-lg border border-white/[0.075] bg-[#0b1115]/96 p-1.5 shadow-[0_16px_34px_rgba(0,0,0,0.34)] backdrop-blur-sm"
                >
                  <Button
                    size="sm"
                    className="justify-start"
                    aria-label="Toggle activity panel"
                    title="Toggle activity panel"
                    aria-pressed={showActivity}
                    onClick={() => {
                      setActivityOpen(scopeId, !showActivity);
                      setActionsMenuOpen(false);
                    }}
                  >
                    Activity
                  </Button>
                  <Button
                    size="sm"
                    className="justify-start"
                    data-vacp-chat-settings-toggle="1"
                    aria-label="Toggle settings"
                    title="Toggle settings"
                    aria-pressed={settingsOpen}
                    onClick={() => {
                      setThreadPickerOpen(false);
                      setSettingsOpen(scopeId, !settingsOpen);
                      setActionsMenuOpen(false);
                    }}
                  >
                    <Settings2 className="h-4 w-4 text-slate-100/90" />
                    Settings
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <Button
                size="sm"
                className="shrink-0"
                aria-label="Toggle activity panel"
                title="Toggle activity panel"
                aria-pressed={showActivity}
                onClick={() => setActivityOpen(scopeId, !showActivity)}
              >
                Activity
              </Button>
              <Button
                size="sm"
                className="shrink-0"
                data-vacp-chat-settings-toggle="1"
                aria-label="Toggle settings"
                title="Toggle settings"
                aria-pressed={settingsOpen}
                onClick={() => {
                  setThreadPickerOpen(false);
                  setSettingsOpen(scopeId, !settingsOpen);
                }}
              >
                <Settings2 className="h-4 w-4 text-slate-100/90" />
                Settings
              </Button>
            </>
          )}
        </div>
      </div>

      <div
        className={cn(
          'grid min-h-0 flex-1 overflow-hidden',
          sidePanelOpen
            ? sidePanelWide
              ? 'grid-cols-[minmax(0,1fr)_minmax(320px,390px)]'
              : 'grid-rows-[minmax(0,1fr)_minmax(260px,44%)]'
            : 'grid-cols-1',
        )}
      >
        <main className="min-h-0 min-w-0 overflow-hidden">
          {!configReady ? (
            <div className="flex h-full min-h-0 items-center justify-center p-6 text-center">
              <div className="max-w-sm">
                <div className="text-sm font-semibold text-slate-100/90">Add provider settings to start chatting.</div>
                <div className="mt-1 text-[11px] text-slate-100/64">
                  Provider, API key, and model are required. Base URL is required for OpenAI-compatible endpoints.
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  className="mt-3"
                  data-vacp-chat-open-settings="1"
                  onClick={() => {
                    setThreadPickerOpen(false);
                    setSettingsOpen(scopeId, true);
                  }}
                >
                  Open settings
                </Button>
              </div>
            </div>
          ) : activeThreadId && activeThread ? (
            <ConfiguredChat
              key={`${activeThreadId}:${activeThread.sessionRevision ?? 0}`}
              bridge={props.bridge}
              runtimeId={props.runtime.runtimeId}
              scopeId={scopeId}
              scopeLabel={scopeMeta.label}
              threadId={activeThreadId}
              sessionRevision={activeThread.sessionRevision}
              panelWidth={rootSize.width}
              config={config}
              initialMessages={activeThread.messages}
              toolEvents={activeThread.toolEvents}
              draft={draft}
              onDraftChange={(value) => setDraft(scopeId, activeThreadId, value)}
              onMessagesChange={(messages) => setThreadMessages(scopeId, activeThreadId, messages)}
              onToolEvent={onToolEvent}
              onRegenerate={() => setThreadPickerOpen(false)}
              onCloseActivity={() => setActivityOpen(scopeId, false)}
              showActivity={showActivity}
              wide={wide}
            />
          ) : (
            <div className="grid h-full place-items-center text-[12px] text-slate-100/70">Preparing chat session...</div>
          )}
        </main>

        {threadPickerOpen ? (
          <aside
            data-vacp-chat-thread-sheet="1"
            className={cn(
              'min-h-0 min-w-0 overflow-hidden bg-white/[0.014]',
              sidePanelWide ? 'border-l border-white/[0.075]' : 'border-t border-white/[0.075]',
            )}
          >
            <div className="flex h-full min-h-0 flex-col p-4">
              <div className="flex items-start justify-between gap-3 pb-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase text-slate-100/70">Conversation history</div>
                  <div className="mt-1 text-pretty text-[11px] text-slate-100/58">
                    Reopen earlier threads without losing the current panel state.
                  </div>
                </div>
                <Button
                  size="sm"
                  aria-label="Close history"
                  title="Close history"
                  onClick={() => setThreadPickerOpen(false)}
                >
                  Close
                </Button>
              </div>
              <div
                data-vacp-chat-thread-list="1"
                className="vacp-chat-scroll grid min-h-0 gap-2 overflow-y-auto overflow-x-hidden"
              >
                {threadItems.length === 0 ? (
                  <div className="px-1 py-3 text-[11px] text-slate-100/58">No history for this view yet.</div>
                ) : null}
                {threadItems.map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    data-vacp-chat-thread-item="1"
                    className={cn(
                      'min-w-0 rounded-md border px-3 py-3 text-left transition-colors',
                      thread.id === activeThreadId
                        ? 'border-emerald-200/22 bg-emerald-300/[0.065]'
                        : 'border-white/[0.075] bg-white/[0.02] hover:border-white/12 hover:bg-white/[0.04]',
                    )}
                    onClick={() => {
                      setActiveThread(scopeId, thread.id);
                      setThreadPickerOpen(false);
                    }}
                  >
                    <div className="truncate text-[12px] font-semibold text-slate-100/90 [overflow-wrap:anywhere]">
                      {thread.title}
                    </div>
                    <div className="mt-1 text-[10px] text-slate-100/62">{threadSubtitle(thread.messages)}</div>
                  </button>
                ))}
              </div>
            </div>
          </aside>
        ) : settingsOpen ? (
          <aside
            data-vacp-chat-settings-sheet="1"
            className={cn(
              'min-h-0 min-w-0 overflow-hidden bg-white/[0.014]',
              sidePanelWide ? 'border-l border-white/[0.075]' : 'border-t border-white/[0.075]',
            )}
          >
            <ChatConfigPanel
              className="h-full max-h-none"
              config={config}
              onConfigChange={setConfig}
              onProviderChange={switchProvider}
              showApiKey={showApiKey}
              onToggleApiKey={() => setShowApiKey((v) => !v)}
              availableModels={availableModels}
              loadingModels={modelsLoading}
              modelsError={modelsError}
              onRefreshModels={() => setModelRefreshSeq((seq) => seq + 1)}
              onClose={() => setSettingsOpen(scopeId, false)}
              onClearConfig={() => {
                clearVacpLLMConfig();
                setConfig(defaultVacpLLMConfigForProvider(config.provider));
                setAvailableModels([]);
                setModelsError(null);
                setModelsLoading(false);
                if (sessionCacheKey) deleteVacpChatSession(sessionCacheKey);
                if (activeThreadId) clearThread(scopeId, activeThreadId);
                setActivityOpen(scopeId, false);
              }}
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
