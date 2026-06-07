import type { UIMessage } from '@ai-sdk/react';
import {
  clearVacpLLMConfig,
  defaultVacpLLMConfigForProvider,
  loadVacpLLMActiveProvider,
  loadVacpLLMConfig,
  saveVacpLLMConfig,
  saveVacpLLMActiveProvider,
  type VacpAgentToolEvent,
  type VacpLLMConfig,
} from '@vacp/agent-client';
import { Activity as ActivityIcon, History, MessageSquare, MessageSquarePlus, Settings2, Trash2 } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useElementSize } from '@vacp/debug-ui/overlay/hooks/use-element-size';
import { Button } from '@vacp/debug-ui/ui/components/ui/button';
import { cn } from '@vacp/debug-ui/ui/lib/utils';

import { ModuleRoot } from '../module-layout';
import type { VacpDebugModuleProps } from '../module-types';
import { ChatConfigPanel } from './chat-config-panel';
import { ConfiguredChat } from './configured-chat';
import { createVacpChatSessionCacheKey, deleteVacpChatSession } from './chat-session-registry';
import { deriveVacpChatScope } from './chat-scope';
import { readThreadDraft, useVacpChatStore } from './chat-store';
import { useChatModelList } from './use-chat-model-list';

const DEFAULT_CONFIG: VacpLLMConfig = defaultVacpLLMConfigForProvider('openai-compatible');

function isConfigReady(config: VacpLLMConfig): boolean {
  const baseFieldsReady = Boolean(config.apiKey.trim() && config.model.trim());
  if (!baseFieldsReady) return false;
  if (config.provider === 'gemini') return true;
  return Boolean(config.providerName.trim() && config.baseURL.trim());
}

function threadSubtitle(messages: UIMessage[]): string {
  if (messages.length === 0) return 'Empty';
  const last = messages[messages.length - 1];
  const role = last.role === 'assistant' ? 'Agent' : last.role === 'user' ? 'You' : 'System';
  return `${messages.length} message${messages.length === 1 ? '' : 's'} / last: ${role}`;
}

function ChatModuleHeader(props: {
  scopeLabel: string;
  description: string;
  status: string;
  statusTone: 'setup' | 'ready' | 'busy';
  compact: boolean;
  primaryActions: ReactNode;
  secondaryActions: ReactNode;
}): ReactElement {
  const statusClass =
    props.statusTone === 'setup'
      ? 'border-amber-100/16 bg-amber-100/[0.055] text-amber-50/72'
      : props.statusTone === 'busy'
        ? 'border-teal-100/18 bg-teal-300/[0.075] text-teal-50/82'
        : 'border-white/[0.075] bg-white/[0.028] text-slate-100/56';

  return (
    <header
      className={cn(
        'grid shrink-0 border-b border-white/[0.075] py-2',
        props.compact ? 'gap-2.5' : 'grid-cols-[minmax(220px,1fr)_auto] items-center gap-4',
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-white/[0.075] bg-white/[0.025] text-slate-100/68">
          <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-[13px] font-semibold leading-5 text-slate-100/90">
              {props.scopeLabel}
            </span>
            <span
              className={cn(
                'hidden h-5 shrink-0 items-center rounded-full border px-2 text-[10px] font-medium sm:inline-flex',
                statusClass,
              )}
            >
              {props.status}
            </span>
          </div>
          <div className="mt-0.5 max-w-[64ch] truncate text-[11px] leading-4 text-slate-100/56">
            {props.description}
          </div>
        </div>
      </div>
      <div
        data-vacp-chat-actions="1"
        className={cn(
          'flex max-w-full items-center gap-1.5',
          props.compact
            ? 'overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
            : 'justify-end',
        )}
      >
        <div className="flex shrink-0 items-center gap-1.5">{props.primaryActions}</div>
        <div className="h-5 w-px shrink-0 bg-white/[0.075]" aria-hidden="true" />
        <div className="flex shrink-0 items-center gap-1.5">{props.secondaryActions}</div>
        <span
          className={cn(
            'inline-flex h-7 shrink-0 items-center rounded-md border px-2 text-[10px] font-medium sm:hidden',
            statusClass,
          )}
        >
          {props.status}
        </span>
      </div>
    </header>
  );
}

export function ChatModule(props: VacpDebugModuleProps): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rootSize = useElementSize(rootRef);
  const wide = rootSize.width >= 960;
  const iconOnlyActions = rootSize.width < 500;
  const compactHeader = rootSize.width < 640;

  const initialConfig = useMemo(() => {
    const activeProvider = loadVacpLLMActiveProvider() ?? DEFAULT_CONFIG.provider;
    return loadVacpLLMConfig(activeProvider) ?? defaultVacpLLMConfigForProvider(activeProvider);
  }, []);
  const [config, setConfig] = useState<VacpLLMConfig>(initialConfig);
  const [credentialRevision, setCredentialRevision] = useState(0);
  const [showApiKey, setShowApiKey] = useState(false);
  const [threadPickerOpen, setThreadPickerOpen] = useState(false);

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
  const centeredWideContent = !settingsOpen && !threadPickerOpen && rootSize.width >= 1040;
  const {
    availableModels,
    loadingModels: modelsLoading,
    modelsError,
    refreshModels,
    resetModels,
  } = useChatModelList({
    config,
    settingsOpen,
  });
  const resetConnectionState = useCallback(() => {
    resetModels();
    setCredentialRevision((revision) => revision + 1);
  }, [resetModels]);
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
      resetConnectionState();
    },
    [config, resetConnectionState],
  );

  const updateConfig = useCallback(
    (nextConfig: VacpLLMConfig) => {
      setConfig(nextConfig);
      if (
        nextConfig.provider !== config.provider ||
        nextConfig.providerName !== config.providerName ||
        nextConfig.baseURL !== config.baseURL ||
        nextConfig.apiKey !== config.apiKey
      ) {
        resetConnectionState();
      }
    },
    [config, resetConnectionState],
  );

  useEffect(() => {
    ensureScope(scopeMeta);
  }, [ensureScope, scopeMeta]);

  const configReady = isConfigReady(config);

  useEffect(() => {
    setThreadPickerOpen(false);
  }, [scopeId]);

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
      credentialRevision,
      runtimeId: props.runtime.runtimeId,
      config,
    });
  }, [scopeId, activeThreadId, activeThread?.sessionRevision, credentialRevision, props.runtime.runtimeId, config]);

  const settingsSheetOpen = configReady && settingsOpen;
  const sidePanelOpen = settingsSheetOpen || threadPickerOpen;
  const sidePanelWide = rootSize.width >= 860;
  const chatStatus = !configReady
    ? 'Setup needed'
    : activeThread
      ? `${activeThread.messages.length} message${activeThread.messages.length === 1 ? '' : 's'}`
      : 'Preparing';
  const chatStatusTone = !configReady ? 'setup' : activeThread ? 'ready' : 'busy';

  return (
    <ModuleRoot rootRef={rootRef} className="flex flex-col overflow-hidden">
      <ChatModuleHeader
        scopeLabel={scopeMeta.label}
        description="Ask questions, run actions, and inspect tool traces."
        status={chatStatus}
        statusTone={chatStatusTone}
        compact={compactHeader}
        primaryActions={
          <div className="flex items-center gap-1.5">
            <Button
              size={iconOnlyActions ? 'iconSm' : 'sm'}
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
              }}
            >
              <History className="h-4 w-4 text-slate-100/90" />
              <span className={iconOnlyActions ? 'sr-only' : ''}>History</span>
            </Button>
            <Button
              size={iconOnlyActions ? 'iconSm' : 'sm'}
              className="shrink-0"
              data-vacp-chat-new-thread="1"
              aria-label="New chat"
              title="Start a new chat thread"
              onClick={() => {
                const nextId = createThread(scopeId);
                if (nextId) setActiveThread(scopeId, nextId);
                setThreadPickerOpen(false);
              }}
            >
              <MessageSquarePlus className="h-4 w-4 text-slate-100/90" />
              <span className={iconOnlyActions ? 'sr-only' : ''}>New</span>
            </Button>
            <Button
              size={iconOnlyActions ? 'iconSm' : 'sm'}
              className="shrink-0"
              data-vacp-chat-clear-thread="1"
              aria-label="Clear active thread"
              title="Clear active thread"
              disabled={!activeThreadId}
              onClick={() => {
                if (!activeThreadId || !sessionCacheKey) return;
                deleteVacpChatSession(sessionCacheKey);
                clearThread(scopeId, activeThreadId);
              }}
            >
              <Trash2 className="h-4 w-4 text-slate-100/90" />
              <span className={iconOnlyActions ? 'sr-only' : ''}>Clear</span>
            </Button>
          </div>
        }
        secondaryActions={
          <div className="flex items-center gap-1.5">
            <Button
              size={iconOnlyActions ? 'iconSm' : 'sm'}
              className="shrink-0"
              aria-label="Toggle activity panel"
              title="Toggle activity panel"
              aria-pressed={showActivity}
              onClick={() => setActivityOpen(scopeId, !showActivity)}
            >
              <ActivityIcon className="h-4 w-4 text-slate-100/90" />
              <span className={iconOnlyActions ? 'sr-only' : ''}>Activity</span>
            </Button>
            <Button
              size={iconOnlyActions ? 'iconSm' : 'sm'}
              className="shrink-0"
              data-vacp-chat-settings-toggle="1"
              aria-label="Toggle settings"
              title={configReady ? 'Toggle settings' : 'Settings are shown in the chat tab'}
              aria-pressed={settingsSheetOpen}
              onClick={() => {
                setThreadPickerOpen(false);
                if (!configReady) {
                  setSettingsOpen(scopeId, false);
                  return;
                }
                setSettingsOpen(scopeId, !settingsSheetOpen);
              }}
            >
              <Settings2 className="h-4 w-4 text-slate-100/90" />
              <span className={iconOnlyActions ? 'sr-only' : ''}>Settings</span>
            </Button>
          </div>
        }
      />

      <div
        className={cn(
          'grid min-h-0 flex-1 overflow-hidden',
          centeredWideContent && 'mx-auto w-full max-w-[1120px]',
          sidePanelOpen
            ? sidePanelWide
              ? 'grid-cols-[minmax(0,1fr)_minmax(320px,390px)]'
              : 'grid-rows-[minmax(0,1fr)_minmax(260px,44%)]'
            : 'grid-cols-1',
        )}
      >
        <main className="min-h-0 min-w-0 overflow-hidden">
          {!configReady ? (
            <div className="flex h-full min-h-0 justify-center overflow-hidden">
              <ChatConfigPanel
                className="h-full max-h-none w-full max-w-[1180px] px-4 py-5"
                config={config}
                onConfigChange={updateConfig}
                onProviderChange={switchProvider}
                showApiKey={showApiKey}
                onToggleApiKey={() => setShowApiKey((v) => !v)}
                availableModels={availableModels}
                loadingModels={modelsLoading}
                modelsError={modelsError}
                onRefreshModels={refreshModels}
                showClose={false}
                onClose={() => setSettingsOpen(scopeId, false)}
                onClearConfig={() => {
                  clearVacpLLMConfig();
                  setConfig(defaultVacpLLMConfigForProvider(config.provider));
                  resetConnectionState();
                  if (sessionCacheKey) deleteVacpChatSession(sessionCacheKey);
                  if (activeThreadId) clearThread(scopeId, activeThreadId);
                  setActivityOpen(scopeId, false);
                }}
              />
            </div>
          ) : activeThreadId && activeThread ? (
            <ConfiguredChat
              key={`${activeThreadId}:${activeThread.sessionRevision ?? 0}:${credentialRevision}`}
              bridge={props.bridge}
              runtimeId={props.runtime.runtimeId}
              scopeId={scopeId}
              scopeLabel={scopeMeta.label}
              threadId={activeThreadId}
              sessionRevision={activeThread.sessionRevision}
              credentialRevision={credentialRevision}
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
            <div className="grid h-full place-items-center text-[12px] text-slate-100/70">
              Preparing chat session...
            </div>
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
                        ? 'border-white/12 bg-white/[0.065]'
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
        ) : settingsSheetOpen ? (
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
              onConfigChange={updateConfig}
              onProviderChange={switchProvider}
              showApiKey={showApiKey}
              onToggleApiKey={() => setShowApiKey((v) => !v)}
              availableModels={availableModels}
              loadingModels={modelsLoading}
              modelsError={modelsError}
              onRefreshModels={refreshModels}
              onClose={() => setSettingsOpen(scopeId, false)}
              onClearConfig={() => {
                clearVacpLLMConfig();
                setConfig(defaultVacpLLMConfigForProvider(config.provider));
                resetConnectionState();
                if (sessionCacheKey) deleteVacpChatSession(sessionCacheKey);
                if (activeThreadId) clearThread(scopeId, activeThreadId);
                setActivityOpen(scopeId, false);
              }}
            />
          </aside>
        ) : null}
      </div>
    </ModuleRoot>
  );
}
