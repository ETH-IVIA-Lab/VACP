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
import { AlertTriangle, Loader2, RefreshCw, Send, Square } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@vacp/debug-ui/ui/components/ui/button';
import { Textarea } from '@vacp/debug-ui/ui/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@vacp/debug-ui/ui/components/ui/tooltip';
import { cn } from '@vacp/debug-ui/ui/lib/utils';

import type { VacpDebugModuleProps } from '../module-types';
import { ChatActivityLog } from './chat-activity-log';
import { ChatMessages } from './chat-messages';
import { createVacpChatSessionCacheKey, getOrCreateVacpChatSession } from './chat-session-registry';
import { useChatAutoscroll } from './use-chat-autoscroll';

const DEFAULT_POLICY: VacpAgentInteractionPolicy = {
  requireUiDemonstration: true,
  minExecuteCallsPerTurn: 3,
  minToolCallsPerTurn: 3,
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

function assistantIncludesExecuteStep(message: UIMessage | undefined): boolean {
  if (!message || message.role !== 'assistant') return false;
  return message.parts.some(
    (part) => part.type === 'tool-vacp_execute' || (part.type === 'dynamic-tool' && part.toolName === 'vacp_execute'),
  );
}

function messageSyncSignature(messages: UIMessage[]): string {
  return messages
    .map((message) => {
      const partSig = message.parts
        .map((part) => {
          if (part.type === 'text' && 'text' in part) return `text:${part.text}`;
          if (part.type === 'reasoning' && 'text' in part) return `reasoning:${part.text}`;
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
          className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-slate-100/70"
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
  threadId: string;
  config: VacpLLMConfig;
  initialMessages: UIMessage[];
  toolEvents: VacpAgentToolEvent[];
  draft: string;
  onDraftChange: (value: string) => void;
  onMessagesChange: (messages: UIMessage[]) => void;
  onToolEvent: (event: VacpAgentToolEvent) => void;
  onRegenerate: () => void;
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
        runtimeId: props.runtimeId,
        config: props.config,
      }),
    [props.scopeId, props.threadId, props.runtimeId, props.config],
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
  const autoScrollSignal = `${status}:${uiMessages.length}:${latestTextLength(uiMessages)}`;
  const { scrollRef, anchorRef, stickToBottom, jumpToLatest } = useChatAutoscroll(autoScrollSignal);
  const [policyNotice, setPolicyNotice] = useState<string | null>(null);
  const onMessagesChangeRef = useRef(props.onMessagesChange);
  const lastSyncedSignatureRef = useRef<string>('');

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
    if (status !== 'ready') return;
    const lastAssistant = [...uiMessages].reverse().find((message) => message.role === 'assistant');
    if (!lastAssistant) return;
    if (!assistantIncludesExecuteStep(lastAssistant)) {
      setPolicyNotice('Ask the agent to demonstrate through UI actions for a more traceable answer.');
      return;
    }
    setPolicyNotice(null);
  }, [status, uiMessages]);

  const submit = async () => {
    const text = props.draft.trim();
    if (!text) return;
    clearError();
    await sendMessage({ text });
    props.onDraftChange('');
  };

  const statusLabel =
    status === 'submitted'
      ? 'Submitting…'
      : status === 'streaming'
        ? 'Streaming…'
        : status === 'error'
          ? 'Error'
          : 'Ready';

  return (
    <div
      className={cn(
        'grid h-full min-h-0 gap-3 overflow-hidden',
        props.showActivity && props.wide ? 'grid-cols-[minmax(0,1fr)_minmax(280px,336px)]' : 'grid-cols-1',
      )}
    >
      <div className="flex min-h-0 flex-col gap-3">
        {error ? (
          <div className="rounded-lg border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-100/90">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 break-words">{error.message}</div>
            </div>
          </div>
        ) : null}

        {policyNotice ? (
          <div className="rounded-lg border border-amber-300/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100/90">
            {policyNotice}
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-xl border border-white/10 bg-slate-950/35 p-2">
          <ChatMessages
            messages={uiMessages}
            status={status}
            scrollRef={scrollRef}
            anchorRef={anchorRef}
            showJumpToLatest={!stickToBottom}
            onJumpToLatest={() => jumpToLatest()}
          />

          <div className="rounded-lg border border-white/10 bg-black/25 p-2">
            <label htmlFor="vacp-chat-input" className="sr-only">
              Chat input
            </label>
            <Textarea
              id="vacp-chat-input"
              data-vacp-chat-input="1"
              className="min-h-[86px] w-full overflow-x-hidden whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
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
            <div className="mt-2 flex flex-wrap items-center gap-2">
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
              <div className="flex min-w-0 flex-wrap items-center gap-1.5 max-sm:w-full sm:ml-auto sm:justify-end">
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
                <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-slate-100/70">
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  <span data-vacp-chat-status="1">{statusLabel}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {props.showActivity ? (
        <ChatActivityLog
          events={props.toolEvents}
          className={cn('min-h-0', props.wide ? 'h-full' : 'h-[240px] overflow-hidden')}
        />
      ) : null}
    </div>
  );
}
