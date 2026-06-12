import type { UIMessage } from '@ai-sdk/react';
import { code } from '@streamdown/code';
import type { ReactElement, RefObject } from 'react';
import { useState } from 'react';
import { Streamdown } from 'streamdown';

import { JsonViewer } from '@vacp/debug-ui/ui/components/ui/json-viewer';
import { cn } from '@vacp/debug-ui/ui/lib/utils';

type UiPart = UIMessage['parts'][number];

const streamdownPlugins = { code };
const TOOL_SUMMARY_LIMIT = 240;

function toolPartName(part: UiPart): string {
  if (part.type === 'dynamic-tool' && 'toolName' in part && typeof part.toolName === 'string') return part.toolName;
  if (part.type.startsWith('tool-')) return part.type.slice(5);
  return part.type;
}

function previewValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw =
    typeof value === 'string'
      ? value
      : (() => {
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        })();
  return raw.length > TOOL_SUMMARY_LIMIT ? `${raw.slice(0, TOOL_SUMMARY_LIMIT)}...` : raw;
}

function toolSummary(part: UiPart): string | null {
  if (!(part.type.startsWith('tool-') || part.type === 'dynamic-tool')) return null;
  if ('errorText' in part && typeof part.errorText === 'string' && part.errorText.length) return part.errorText;
  if ('output' in part) return previewValue(part.output);
  if ('input' in part) return previewValue(part.input);
  return null;
}

function ToolPartDetails(props: { part: UiPart; idx: number }): ReactElement {
  const state = 'state' in props.part ? String(props.part.state) : undefined;
  const callId =
    'toolCallId' in props.part && typeof props.part.toolCallId === 'string' ? props.part.toolCallId : undefined;
  const input = 'input' in props.part ? props.part.input : undefined;
  const output = 'output' in props.part ? props.part.output : undefined;
  const errorText = 'errorText' in props.part ? props.part.errorText : undefined;
  const name = toolPartName(props.part);
  const forceOpen = state === 'input-streaming' || state === 'output-error' || Boolean(errorText);
  const [opened, setOpened] = useState(forceOpen);
  const expanded = forceOpen || opened;
  const stablePayload = state !== 'input-streaming' && state !== 'output-streaming';

  return (
    <details
      key={`tool-${props.idx}`}
      open={expanded}
      onToggle={(event) => setOpened((event.currentTarget as HTMLDetailsElement).open)}
      className="rounded-lg border border-white/[0.075] bg-white/[0.02] px-2 py-2"
      data-vacp-chat-tool-details="1"
    >
      <summary className="grid cursor-pointer list-none gap-1 text-[11px] text-slate-100/85">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-100/90">{name}</span>
          {state ? (
            <span className="rounded-full border border-white/[0.075] bg-white/[0.035] px-2 py-0.5 text-[10px] text-slate-100/66">
              {state}
            </span>
          ) : null}
          {callId ? <span className="text-[10px] text-slate-100/55 [overflow-wrap:anywhere]">{callId}</span> : null}
        </div>
        {toolSummary(props.part) ? (
          <div className="truncate text-[10px] text-slate-100/60">{toolSummary(props.part)}</div>
        ) : null}
      </summary>
      {expanded ? (
        <div className="mt-2 grid gap-2">
          {input !== undefined ? (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-100/65">Input</div>
              {stablePayload ? (
                <JsonViewer value={input} className="vacp-chat-json-view mt-1 p-2" expandDepth={1} scrollable={false} />
              ) : (
                <pre className="mt-1 max-h-32 overflow-auto rounded-md border border-white/[0.075] bg-white/[0.018] p-2 text-[10px] text-slate-100/70">
                  {previewValue(input) ?? 'Streaming input...'}
                </pre>
              )}
            </div>
          ) : null}
          {output !== undefined ? (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-100/65">Output</div>
              {stablePayload ? (
                <JsonViewer
                  value={output}
                  className="vacp-chat-json-view mt-1 p-2"
                  expandDepth={1}
                  scrollable={false}
                />
              ) : (
                <pre className="mt-1 max-h-32 overflow-auto rounded-md border border-white/[0.075] bg-white/[0.018] p-2 text-[10px] text-slate-100/70">
                  {previewValue(output) ?? 'Streaming output...'}
                </pre>
              )}
            </div>
          ) : null}
          {errorText ? (
            <div className="rounded-md border border-red-200/18 bg-red-300/[0.07] px-2 py-1 text-[11px] text-red-50/84">
              {errorText}
            </div>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

function renderPart(part: UiPart, idx: number, streaming: boolean): ReactElement | null {
  if (part.type === 'text' && 'text' in part) {
    return (
      <div key={`text-${idx}`} className="vacp-chat-streamdown text-[12px] leading-5 text-slate-100/90">
        <Streamdown isAnimating={streaming} plugins={streamdownPlugins}>
          {part.text}
        </Streamdown>
      </div>
    );
  }

  if (part.type === 'reasoning' && 'text' in part) {
    return (
      <details
        key={`reasoning-${idx}`}
        className="min-w-0 rounded-md border border-white/[0.075] bg-white/[0.02] px-2 py-1 text-[11px] text-slate-100/72"
      >
        <summary className="cursor-pointer select-none font-medium text-slate-100/75">Reasoning</summary>
        <div className="vacp-chat-reasoning vacp-chat-streamdown mt-1 text-[11px] leading-5 text-slate-100/80">
          <Streamdown isAnimating={streaming} plugins={streamdownPlugins}>
            {part.text}
          </Streamdown>
        </div>
      </details>
    );
  }

  if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
    return <ToolPartDetails key={`tool-${idx}`} part={part} idx={idx} />;
  }

  if (part.type === 'step-start') return null;

  return (
    <div
      key={`part-${idx}`}
      className="rounded-md border border-white/[0.075] bg-white/[0.025] px-2 py-1 text-[11px] text-slate-100/66"
    >
      {part.type}
    </div>
  );
}

export function ChatMessages(props: {
  messages: UIMessage[];
  status: 'submitted' | 'streaming' | 'ready' | 'error';
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  showJumpToLatest: boolean;
  onJumpToLatest: () => void;
  compact?: boolean;
}): ReactElement {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={props.scrollRef}
        data-vacp-chat-msgs="1"
        className="vacp-chat-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1"
      >
        <div
          ref={props.contentRef}
          className={cn(
            'mx-auto flex min-h-full w-full max-w-4xl flex-col',
            props.compact ? 'gap-2 pb-2' : 'gap-3 pb-4',
          )}
        >
          {props.messages.length === 0 ? (
            <div className={cn('px-1 text-[12px] text-slate-100/64', props.compact ? 'py-2' : 'py-4')}>
              <div className="font-medium text-slate-100/85">Start with a concrete question.</div>
              <div className="mt-1 text-pretty">
                The agent can inspect capabilities, read state, execute exposed actions, and explain what changed.
              </div>
            </div>
          ) : null}

          {props.messages.map((message) => {
            const roleLabel = message.role === 'assistant' ? 'Agent' : message.role === 'user' ? 'You' : 'System';
            return (
              <div
                key={message.id}
                data-vacp-chat-message-role={message.role}
                className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={cn(
                    'w-full max-w-[min(100%,52rem)] rounded-lg border shadow-sm',
                    props.compact ? 'px-3 py-2' : 'px-4 py-3',
                    message.role === 'assistant'
                      ? 'border-white/[0.075] bg-white/[0.026]'
                      : message.role === 'user'
                        ? 'border-white/12 bg-white/[0.07]'
                        : 'border-white/[0.075] bg-white/[0.02]',
                  )}
                >
                  <div
                    className={cn(
                      'text-[10px] font-semibold uppercase text-slate-100/60',
                      props.compact ? 'mb-1' : 'mb-2',
                    )}
                  >
                    {roleLabel}
                  </div>
                  <div className="grid gap-2">
                    {message.parts.map((part, idx) => renderPart(part, idx, props.status === 'streaming'))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {props.showJumpToLatest ? (
        <button
          type="button"
          className="absolute bottom-4 right-4 rounded-md border border-white/14 bg-white/[0.08] px-2 py-1 text-[11px] font-medium text-slate-50/84 hover:bg-white/[0.12]"
          onClick={props.onJumpToLatest}
        >
          Jump to latest
        </button>
      ) : null}
    </div>
  );
}
