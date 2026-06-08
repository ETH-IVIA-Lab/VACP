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
import { Activity as ActivityIcon, History, MessageSquarePlus, Settings2, Trash2, X } from 'lucide-react';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DEBUG_UI_PANEL_BREAKPOINTS, isDenseDebugPanel } from '@vacp/debug-ui/overlay/debug-ui-breakpoints';
import { useElementSize } from '@vacp/debug-ui/overlay/hooks/use-element-size';
import { Button } from '@vacp/debug-ui/ui/components/ui/button';
import { cn } from '@vacp/debug-ui/ui/lib/utils';

import { ModuleHeader, ModulePane, ModuleRoot } from '../module-layout';
import type { VacpDebugModuleProps } from '../module-types';
import { ChatConfigPanel } from './chat-config-panel';
import { ChatSetupSurface } from './chat-setup-surface';
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

export function ChatModule(props: VacpDebugModuleProps): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rootSize = useElementSize(rootRef);
  const dense = isDenseDebugPanel(rootSize.width, rootSize.height);
  const compactControls = rootSize.width < DEBUG_UI_PANEL_BREAKPOINTS.compactControls;

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
  const configReady = isConfigReady(config);
  const {
    availableModels,
    loadingModels: modelsLoading,
    modelsError,
    refreshModels,
    resetModels,
  } = useChatModelList({
    config,
    modelPanelVisible: settingsOpen || !configReady,
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

  useEffect(() => {
    if (!configReady) setSettingsOpen(scopeId, true);
  }, [configReady, scopeId, setSettingsOpen]);

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

  const settingsSheetOpen = settingsOpen;
  const sidePanelOpen = settingsSheetOpen || threadPickerOpen;
  const showSideBySide = sidePanelOpen && rootSize.width >= DEBUG_UI_PANEL_BREAKPOINTS.splitPane;
  const boundWide = rootSize.width >= DEBUG_UI_PANEL_BREAKPOINTS.splitPane;
  const chatStatus = !configReady
    ? 'Setup needed'
    : activeThread
      ? `${activeThread.messages.length} message${activeThread.messages.length === 1 ? '' : 's'}`
      : 'Preparing';

  return (
    <ModuleRoot
      rootRef={rootRef}
      boundWide={boundWide}
      className={cn(
        'h-full min-h-0',
        dense ? 'gap-2' : 'gap-3',
        sidePanelOpen
          ? showSideBySide
            ? 'grid grid-cols-[minmax(0,1fr)_minmax(320px,420px)]'
            : 'flex flex-col'
          : 'flex flex-col',
      )}
    >
      <ModulePane className={cn('flex min-h-0 flex-1 flex-col', dense ? 'gap-2' : 'gap-3')}>
        <ModuleHeader
          title="Chat"
          description={`${scopeMeta.label} / ${chatStatus} / Ask questions, run actions, and inspect tool traces.`}
          compact={compactControls}
          actions={
            <>
              <Button
                size="iconSm"
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
              </Button>
              <Button
                size="iconSm"
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
              </Button>
              <Button
                size="iconSm"
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
              </Button>
              <Button
                size="iconSm"
                className="shrink-0"
                aria-label="Toggle activity panel"
                title="Toggle activity panel"
                aria-pressed={showActivity}
                onClick={() => setActivityOpen(scopeId, !showActivity)}
              >
                <ActivityIcon className="h-4 w-4 text-slate-100/90" />
              </Button>
              <Button
                size="iconSm"
                className="shrink-0"
                data-vacp-chat-settings-toggle="1"
                aria-label="Toggle settings"
                title="Toggle settings"
                aria-pressed={settingsSheetOpen}
                onClick={() => {
                  setThreadPickerOpen(false);
                  setSettingsOpen(scopeId, !settingsSheetOpen);
                }}
              >
                <Settings2 className="h-4 w-4 text-slate-100/90" />
              </Button>
            </>
          }
        />

        <div className="min-h-0 flex-1 overflow-hidden">
          {activeThreadId && activeThread ? (
            configReady ? (
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
              />
            ) : (
              <ChatSetupSurface
                scopeLabel={scopeMeta.label}
                panelWidth={rootSize.width}
                config={config}
                messages={activeThread.messages}
                toolEvents={activeThread.toolEvents}
                draft={draft}
                onDraftChange={(value) => setDraft(scopeId, activeThreadId, value)}
                onOpenSettings={() => {
                  setThreadPickerOpen(false);
                  setSettingsOpen(scopeId, true);
                }}
              />
            )
          ) : (
            <div className="grid h-full place-items-center text-[12px] text-slate-100/70">
              Preparing chat session...
            </div>
          )}
        </div>
      </ModulePane>

      {threadPickerOpen ? (
        <ModulePane
          data-vacp-chat-thread-sheet="1"
          className={cn(
            'flex min-h-0 flex-col overflow-hidden bg-white/[0.014]',
            !showSideBySide && 'max-h-[45%]',
            dense ? 'gap-2' : 'gap-3',
          )}
        >
          <ModuleHeader
            title="Conversation history"
            description="Reopen earlier threads without losing the current panel state."
            actions={
              <Button
                size="iconSm"
                aria-label="Close history"
                title="Close history"
                onClick={() => setThreadPickerOpen(false)}
              >
                <X className="h-4 w-4 text-slate-100/90" />
              </Button>
            }
          />
          <div
            data-vacp-chat-thread-list="1"
            className="vacp-chat-scroll grid min-h-0 gap-2 overflow-y-auto overflow-x-hidden border-t border-white/[0.075] pt-3"
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
        </ModulePane>
      ) : settingsSheetOpen ? (
        <ModulePane
          data-vacp-chat-settings-sheet="1"
          className={cn('min-h-0 min-w-0 overflow-hidden bg-white/[0.014]', !showSideBySide && 'max-h-[45%]')}
        >
          <ChatConfigPanel
            className="h-full max-h-none"
            compact={true}
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
              setSettingsOpen(scopeId, true);
            }}
          />
        </ModulePane>
      ) : null}
    </ModuleRoot>
  );
}
