import type { UIMessage } from '@ai-sdk/react';
import { code } from '@streamdown/code';
import type { ReactElement, RefObject } from 'react';
import { Streamdown } from 'streamdown';

import { JsonViewer } from '@vacp/debug-ui/ui/components/ui/json-viewer';
import { cn } from '@vacp/debug-ui/ui/lib/utils';

type UiPart = UIMessage['parts'][number];

const streamdownPlugins = { code };

function toolPartName(part: UiPart): string {
  if (part.type === 'dynamic-tool' && 'toolName' in part && typeof part.toolName === 'string') return part.toolName;
  if (part.type.startsWith('tool-')) return part.type.slice(5);
  return part.type;
}

function previewValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toolSummary(part: UiPart): string | null {
  if (!(part.type.startsWith('tool-') || part.type === 'dynamic-tool')) return null;
  if ('errorText' in part && typeof part.errorText === 'string' && part.errorText.length) return part.errorText;
  if ('output' in part) return previewValue(part.output);
  if ('input' in part) return previewValue(part.input);
  return null;
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
    const state = 'state' in part ? String(part.state) : undefined;
    const callId = 'toolCallId' in part && typeof part.toolCallId === 'string' ? part.toolCallId : undefined;
    const input = 'input' in part ? part.input : undefined;
    const output = 'output' in part ? part.output : undefined;
    const errorText = 'errorText' in part ? part.errorText : undefined;
    const name = toolPartName(part);
    const forceOpen = state === 'input-streaming' || state === 'output-error' || Boolean(errorText);

    return (
      <details
        key={`tool-${idx}`}
        open={forceOpen}
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
          {toolSummary(part) ? <div className="truncate text-[10px] text-slate-100/60">{toolSummary(part)}</div> : null}
        </summary>
        <div className="mt-2 grid gap-2">
          {input !== undefined ? (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-100/65">Input</div>
              <JsonViewer value={input} className="vacp-chat-json-view mt-1 p-2" expandDepth={1} scrollable={false} />
            </div>
          ) : null}
          {output !== undefined ? (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-100/65">Output</div>
              <JsonViewer value={output} className="vacp-chat-json-view mt-1 p-2" expandDepth={1} scrollable={false} />
            </div>
          ) : null}
          {errorText ? (
            <div className="rounded-md border border-red-200/18 bg-red-300/[0.07] px-2 py-1 text-[11px] text-red-50/84">
              {errorText}
            </div>
          ) : null}
        </div>
      </details>
    );
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
}): ReactElement {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={props.scrollRef}
        data-vacp-chat-msgs="1"
        className="vacp-chat-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1"
      >
        <div ref={props.contentRef} className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-3 pb-4">
          {props.messages.length === 0 ? (
            <div className="rounded-lg border border-white/[0.075] bg-white/[0.02] px-4 py-4 text-[12px] text-slate-100/68">
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
                    'w-full max-w-[min(100%,52rem)] rounded-lg border px-4 py-3 shadow-sm',
                    message.role === 'assistant'
                      ? 'border-white/[0.075] bg-white/[0.026]'
                      : message.role === 'user'
                        ? 'border-emerald-200/18 bg-emerald-300/[0.055]'
                        : 'border-white/[0.075] bg-white/[0.02]',
                  )}
                >
                  <div className="mb-2 text-[10px] font-semibold uppercase text-slate-100/60">{roleLabel}</div>
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
          className="absolute bottom-4 right-4 rounded-md border border-emerald-200/24 bg-emerald-300/[0.09] px-2 py-1 text-[11px] font-medium text-emerald-50/84 hover:bg-emerald-300/[0.13]"
          onClick={props.onJumpToLatest}
        >
          Jump to latest
        </button>
      ) : null}
    </div>
  );
}
