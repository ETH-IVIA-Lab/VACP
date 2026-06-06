import { type Chat, useChat, type UIMessage } from '@ai-sdk/react';
import {
  type VacpAgentInteractionPolicy,
  type VacpAgentToolEvent,
  type VacpChatMessageMetadata,
  createVacpChatRuntime,
  createWindowVacpTransport,
  defaultVacpContextCompactionPolicy,
  type VacpLLMConfig,
  type VacpTokenUsage,
} from '@vacp/agent-client';
import { AlertTriangle, ClipboardCopy, Loader2, RefreshCw, Send, Square } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@vacp/debug-ui/ui/components/ui/button';
import { Textarea } from '@vacp/debug-ui/ui/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@vacp/debug-ui/ui/components/ui/tooltip';
import { copyTextToClipboard } from '@vacp/debug-ui/ui/lib/clipboard';
import { cn } from '@vacp/debug-ui/ui/lib/utils';

import type { VacpDebugModuleProps } from '../module-types';
import { ChatActivityLog } from './chat-activity-log';
import { exportConversationAsMarkdown } from './chat-export';
import { ChatMessages } from './chat-messages';
import { createVacpChatSessionCacheKey, getOrCreateVacpChatSession } from './chat-session-registry';
import { messageSyncSignature } from './message-sync-signature';
import { useChatAutoscroll } from './use-chat-autoscroll';

const DEFAULT_POLICY: VacpAgentInteractionPolicy = {
  requireUiDemonstration: true,
  minExecuteCallsPerTurn: 0,
  minToolCallsPerTurn: 2,
};

function latestTextLength(messages: UIMessage[]): number {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) return 0;
  const lastPart = lastMessage.parts[lastMessage.parts.length - 1];
  if (!lastPart) return 0;
  if (lastPart.type === 'text' && 'text' in lastPart) return lastPart.text.length;
  if (lastPart.type === 'reasoning' && 'text' in lastPart) return lastPart.text.length;
  return 0;
}

function assistantToolCallCount(message: UIMessage | undefined): number {
  if (!message || message.role !== 'assistant') return 0;
  return message.parts.filter((part) => part.type.startsWith('tool-') || part.type === 'dynamic-tool').length;
}

function assistantExecuteCallCount(message: UIMessage | undefined): number {
  if (!message || message.role !== 'assistant') return 0;
  return message.parts.filter(
    (part) => part.type === 'tool-vacp_execute' || (part.type === 'dynamic-tool' && part.toolName === 'vacp_execute'),
  ).length;
}

function normalizeTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function emptyUsage(usage: VacpTokenUsage | null | undefined): boolean {
  if (!usage) return true;
  return (
    usage.inputTokens == null &&
    usage.outputTokens == null &&
    usage.totalTokens == null &&
    usage.reasoningTokens == null &&
    usage.textTokens == null &&
    usage.cacheReadTokens == null &&
    usage.cacheWriteTokens == null &&
    usage.noCacheTokens == null
  );
}

function usageTotal(usage: VacpTokenUsage | null | undefined): number | undefined {
  if (!usage) return undefined;
  const total = normalizeTokenCount(usage.totalTokens);
  if (total != null) return total;
  const input = normalizeTokenCount(usage.inputTokens);
  const output = normalizeTokenCount(usage.outputTokens);
  if (input == null && output == null) return undefined;
  return (input ?? 0) + (output ?? 0);
}

function addUsage(current: VacpTokenUsage, next: VacpTokenUsage): VacpTokenUsage {
  const sum = (a: number | undefined, b: number | undefined) =>
    a == null && b == null ? undefined : (a ?? 0) + (b ?? 0);
  return {
    inputTokens: sum(current.inputTokens, next.inputTokens),
    outputTokens: sum(current.outputTokens, next.outputTokens),
    totalTokens: sum(current.totalTokens, next.totalTokens),
    reasoningTokens: sum(current.reasoningTokens, next.reasoningTokens),
    textTokens: sum(current.textTokens, next.textTokens),
    cacheReadTokens: sum(current.cacheReadTokens, next.cacheReadTokens),
    cacheWriteTokens: sum(current.cacheWriteTokens, next.cacheWriteTokens),
    noCacheTokens: sum(current.noCacheTokens, next.noCacheTokens),
  };
}

function assistantUsageForMessage(message: UIMessage): VacpTokenUsage | null {
  if (message.role !== 'assistant') return null;
  if (!message.metadata || typeof message.metadata !== 'object') return null;
  const metadata = message.metadata as VacpChatMessageMetadata;
  const usage = metadata.totalUsage ?? metadata.stepUsage;
  if (emptyUsage(usage)) return null;
  return usage ?? null;
}

function latestAssistantUsage(messages: UIMessage[]): VacpTokenUsage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const usage = assistantUsageForMessage(messages[i]!);
    if (usage) return usage;
  }
  return null;
}

function threadUsage(messages: UIMessage[]): VacpTokenUsage | null {
  let aggregate: VacpTokenUsage | null = null;
  for (const message of messages) {
    const usage = assistantUsageForMessage(message);
    if (!usage) continue;
    aggregate = aggregate ? addUsage(aggregate, usage) : { ...usage };
  }
  return aggregate;
}

function formatTokens(value: number | undefined): string {
  if (value == null) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function TokenUsageBadge(props: {
  label: string;
  usage: VacpTokenUsage | null;
  dataAttribute: string;
  align?: 'start' | 'center' | 'end';
}): ReactElement | null {
  if (emptyUsage(props.usage)) return null;
  const total = usageTotal(props.usage);
  if (total == null) return null;
  const attrs: Record<string, string> = { [props.dataAttribute]: '1' };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          {...attrs}
          className="inline-flex items-center gap-1 rounded-full border border-white/[0.075] bg-white/[0.035] px-2 py-1 text-[10px] text-slate-100/62"
        >
          <span className="text-slate-100/55">{props.label}</span>
          <span className="font-semibold text-slate-100/85">{formatTokens(total)}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" align={props.align ?? 'end'} className="pointer-events-auto">
        <div className="grid gap-1 text-[10px] leading-4 text-slate-100/90">
          <div className="font-semibold text-slate-100/95">{props.label} tokens</div>
          <div>Total: {formatTokens(total)}</div>
          {props.usage?.inputTokens != null ? <div>Input: {formatTokens(props.usage.inputTokens)}</div> : null}
          {props.usage?.outputTokens != null ? <div>Output: {formatTokens(props.usage.outputTokens)}</div> : null}
          {props.usage?.textTokens != null ? <div>Text: {formatTokens(props.usage.textTokens)}</div> : null}
          {props.usage?.reasoningTokens != null ? (
            <div>Reasoning: {formatTokens(props.usage.reasoningTokens)}</div>
          ) : null}
          {props.usage?.cacheReadTokens != null ? (
            <div>Cache read: {formatTokens(props.usage.cacheReadTokens)}</div>
          ) : null}
          {props.usage?.cacheWriteTokens != null ? (
            <div>Cache write: {formatTokens(props.usage.cacheWriteTokens)}</div>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

type ConfiguredChatProps = {
  bridge: VacpDebugModuleProps['bridge'];
  runtimeId: string | undefined;
  scopeId: string;
  scopeLabel: string;
  threadId: string;
  sessionRevision?: number;
  panelWidth: number;
  config: VacpLLMConfig;
  initialMessages: UIMessage[];
  toolEvents: VacpAgentToolEvent[];
  draft: string;
  onDraftChange: (value: string) => void;
  onMessagesChange: (messages: UIMessage[]) => void;
  onToolEvent: (event: VacpAgentToolEvent) => void;
  onRegenerate: () => void;
  onCloseActivity: () => void;
  showActivity: boolean;
  wide: boolean;
};

export function ConfiguredChat(props: ConfiguredChatProps): ReactElement {
  const runtime = useMemo(
    () =>
      createVacpChatRuntime({
        config: props.config,
        transport: createWindowVacpTransport(props.bridge),
        onToolEvent: props.onToolEvent,
        interactionPolicy: DEFAULT_POLICY,
        contextCompactionPolicy: defaultVacpContextCompactionPolicy,
      }),
    [props.bridge, props.config, props.onToolEvent],
  );

  const sessionCacheKey = useMemo(
    () =>
      createVacpChatSessionCacheKey({
        scopeId: props.scopeId,
        threadId: props.threadId,
        sessionRevision: props.sessionRevision,
        runtimeId: props.runtimeId,
        config: props.config,
      }),
    [props.scopeId, props.threadId, props.sessionRevision, props.runtimeId, props.config],
  );

  const chat = useMemo(
    () =>
      getOrCreateVacpChatSession({
        cacheKey: sessionCacheKey,
        id: `vacp-chat:${props.scopeId}:${props.threadId}`,
        messages: props.initialMessages,
        transport: runtime.transport,
      }),
    [props.scopeId, props.threadId, props.initialMessages, runtime.transport, sessionCacheKey],
  );

  const { messages, sendMessage, status, stop, error, clearError, regenerate } = useChat({
    chat: chat as Chat<UIMessage>,
  });
  const uiMessages = messages as UIMessage[];
  const lastUsage = useMemo(() => latestAssistantUsage(uiMessages), [uiMessages]);
  const totalUsage = useMemo(() => threadUsage(uiMessages), [uiMessages]);
  const busy = status === 'submitted' || status === 'streaming';
  const activityWide = props.panelWidth >= 1120;
  const autoScrollSignal = `${status}:${uiMessages.length}:${latestTextLength(uiMessages)}`;
  const { scrollRef, contentRef, stickToBottom, jumpToLatest } = useChatAutoscroll(autoScrollSignal);
  const [policyNotice, setPolicyNotice] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const onMessagesChangeRef = useRef(props.onMessagesChange);
  const lastSyncedSignatureRef = useRef<string>('');
  const submitLockRef = useRef(false);

  useEffect(() => {
    onMessagesChangeRef.current = props.onMessagesChange;
  }, [props.onMessagesChange]);

  useEffect(() => {
    const signature = messageSyncSignature(uiMessages);
    if (signature === lastSyncedSignatureRef.current) return;
    lastSyncedSignatureRef.current = signature;
    onMessagesChangeRef.current(uiMessages);
  }, [uiMessages]);

  useEffect(() => {
    if (status === 'submitted' || status === 'streaming') {
      submitLockRef.current = true;
      return;
    }
    submitLockRef.current = false;
  }, [status]);

  useEffect(() => {
    if (!copyNotice) return;
    const timer = window.setTimeout(() => setCopyNotice(null), 2400);
    return () => window.clearTimeout(timer);
  }, [copyNotice]);

  useEffect(() => {
    if (status !== 'ready') return;
    const lastAssistant = [...uiMessages].reverse().find((message) => message.role === 'assistant');
    if (!lastAssistant) return;
    const minExecutes = DEFAULT_POLICY.minExecuteCallsPerTurn ?? 0;
    const minToolCalls = DEFAULT_POLICY.minToolCallsPerTurn ?? 0;
    if (minExecutes > 0 && assistantExecuteCallCount(lastAssistant) < minExecutes) {
      setPolicyNotice('Ask the agent to demonstrate through UI actions for a more traceable answer.');
      return;
    }
    if (minToolCalls > 0 && assistantToolCallCount(lastAssistant) < minToolCalls) {
      setPolicyNotice('Ask the agent to ground the answer with more tool-backed evidence.');
      return;
    }
    setPolicyNotice(null);
  }, [status, uiMessages]);

  const submit = async () => {
    if (busy || submitLockRef.current) return;
    const text = props.draft.trim();
    if (!text) return;
    const previousDraft = props.draft;
    submitLockRef.current = true;
    clearError();
    props.onDraftChange('');
    try {
      await sendMessage({ text });
    } catch {
      props.onDraftChange(previousDraft);
      submitLockRef.current = false;
    }
  };

  const copyConversation = async () => {
    const markdown = exportConversationAsMarkdown({
      scopeLabel: props.scopeLabel,
      config: props.config,
      messages: uiMessages,
      toolEvents: props.toolEvents,
    });
    await copyTextToClipboard(markdown);
    setCopyNotice('Conversation copied as Markdown.');
  };

  const statusLabel =
    status === 'submitted'
      ? 'Submitting…'
      : status === 'streaming'
        ? 'Streaming…'
        : status === 'error'
          ? 'Error'
          : 'Ready';
  const threadSummary =
    uiMessages.length === 0
      ? 'Ask about the active visualization and the agent will ground its answer with tool-backed evidence.'
      : `${uiMessages.length} message${uiMessages.length === 1 ? '' : 's'} in the active thread.`;

  return (
    <div
      className={cn(
        'relative grid h-full min-h-0 overflow-hidden',
        props.showActivity
          ? activityWide
            ? 'grid-cols-[minmax(0,1fr)_minmax(320px,380px)]'
            : 'grid-rows-[minmax(0,1fr)_minmax(220px,36%)]'
          : 'grid-cols-1',
      )}
    >
      <div className="flex min-h-0 flex-col">
        {error ? (
          <div className="mb-2 rounded-md border border-red-200/18 bg-red-300/[0.07] px-3 py-2 text-[11px] text-red-50/84">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 break-words">{error.message}</div>
            </div>
          </div>
        ) : null}

        {policyNotice ? (
          <div className="mb-2 rounded-md border border-amber-100/14 bg-amber-100/[0.055] px-3 py-2 text-[11px] text-amber-50/70">
            {policyNotice}
          </div>
        ) : null}

        <section className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
          <div className="flex flex-wrap items-start gap-3 border-b border-white/[0.075] px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase text-slate-100/70">Conversation</div>
              <div className="mt-1 text-pretty text-[11px] text-slate-100/62">{threadSummary}</div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                aria-label="Copy conversation as Markdown"
                title="Copy conversation as Markdown"
                onClick={() => void copyConversation()}
              >
                <ClipboardCopy className="h-3.5 w-3.5 text-slate-100/90" />
                Copy markdown
              </Button>
              <TokenUsageBadge
                label="Last"
                usage={lastUsage}
                dataAttribute="data-vacp-chat-token-last"
                align="center"
              />
              <TokenUsageBadge
                label="Thread"
                usage={totalUsage}
                dataAttribute="data-vacp-chat-token-thread"
                align="center"
              />
              <div className="inline-flex items-center gap-1 rounded-full border border-white/[0.075] bg-white/[0.035] px-2.5 py-1 text-[10px] text-slate-100/62">
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                <span data-vacp-chat-status="1">{statusLabel}</span>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 overflow-hidden px-3 py-3">
            <ChatMessages
              messages={uiMessages}
              status={status}
              scrollRef={scrollRef}
              contentRef={contentRef}
              showJumpToLatest={!stickToBottom}
              onJumpToLatest={() => jumpToLatest()}
            />
          </div>

          <div className="relative z-10 border-t border-white/[0.075] bg-[#0b1115]/88 px-3 py-3 backdrop-blur-sm">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-100/56">
              <div className="min-w-0 flex-1 text-pretty">
                {busy
                  ? status === 'submitted'
                    ? 'Request received. Preparing the next turn…'
                    : 'Request received. The agent is working through the turn.'
                  : 'Press Enter to send or Shift+Enter for a newline.'}
              </div>
              {copyNotice ? <div className="text-emerald-50/74">{copyNotice}</div> : null}
              {props.showActivity ? (
                <Button size="sm" aria-label="Hide activity" title="Hide activity" onClick={props.onCloseActivity}>
                  Hide activity
                </Button>
              ) : null}
            </div>

            <label htmlFor="vacp-chat-input" className="sr-only">
              Chat input
            </label>
            <Textarea
              id="vacp-chat-input"
              data-vacp-chat-input="1"
              className="min-h-[96px] w-full overflow-x-hidden whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
              wrap="soft"
              value={props.draft}
              onChange={(e) => props.onDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.shiftKey) return;
                e.preventDefault();
                void submit();
              }}
              placeholder="Ask about the active visualization..."
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                data-vacp-chat-send="1"
                aria-label="Send message"
                title="Send message"
                disabled={busy || !props.draft.trim()}
                onClick={() => void submit()}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin text-slate-100/90" />
                ) : (
                  <Send className="h-4 w-4 text-slate-100/90" />
                )}
                Send
              </Button>
              <Button
                size="sm"
                data-vacp-chat-stop="1"
                aria-label="Stop response"
                title="Stop response"
                disabled={!busy}
                onClick={() => void stop()}
              >
                <Square className="h-3.5 w-3.5 text-slate-100/90" />
                Stop
              </Button>
              <Button
                size="sm"
                aria-label="Regenerate response"
                title="Regenerate response"
                disabled={busy || uiMessages.length === 0}
                onClick={() => {
                  props.onRegenerate();
                  void regenerate();
                }}
              >
                <RefreshCw className="h-3.5 w-3.5 text-slate-100/90" />
                Regenerate
              </Button>
            </div>
          </div>
        </section>
      </div>

      {props.showActivity ? (
        <ChatActivityLog
          events={props.toolEvents}
          className={cn(
            'min-h-0 h-full bg-white/[0.014]',
            activityWide ? 'border-l border-white/[0.075]' : 'border-t border-white/[0.075]',
          )}
        />
      ) : null}
    </div>
  );
}
