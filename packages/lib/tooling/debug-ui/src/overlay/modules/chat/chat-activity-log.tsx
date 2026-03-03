import type { ReactElement } from 'react';

import type { VacpAgentToolEvent } from '@vacp/agent-client';
import { JsonViewer } from '@vacp/debug-ui/ui/components/ui/json-viewer';
import { cn } from '@vacp/debug-ui/ui/lib/utils';

function eventColor(status: VacpAgentToolEvent['status']): string {
  if (status === 'succeeded') return 'text-emerald-200/90';
  if (status === 'failed') return 'text-rose-200/90';
  return 'text-amber-100/90';
}

function capabilitiesScopeBadge(event: VacpAgentToolEvent): 'full' | 'scoped' | null {
  if (event.toolName !== 'vacp_capabilities') return null;
  if (!event.input || typeof event.input !== 'object' || Array.isArray(event.input)) return 'full';
  return Object.keys(event.input as Record<string, unknown>).length > 0 ? 'scoped' : 'full';
}

export function ChatActivityLog(props: { events: VacpAgentToolEvent[]; className?: string }): ReactElement {
  return (
    <section
      className={cn('grid min-h-0 gap-2 rounded-xl border border-white/10 bg-slate-950/35 p-3', props.className)}
    >
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase text-slate-100/70">Tool calls</div>
        <div className="mt-1 text-[11px] text-slate-100/65">Execution trace for the active thread.</div>
      </div>

      <div
        data-vacp-chat-log="1"
        className="vacp-chat-scroll grid min-h-0 gap-2 overflow-y-auto overflow-x-hidden text-[11px]"
      >
        {props.events.length === 0 ? (
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-slate-100/70">
            No tool calls yet.
          </div>
        ) : null}

        {props.events
          .slice()
          .reverse()
          .map((event, idx) => {
            const scope = capabilitiesScopeBadge(event);
            return (
              <details
                key={`${event.at}-${idx}`}
                open={event.status === 'failed'}
                className="rounded-lg border border-white/10 bg-black/20 px-3 py-2"
              >
                <summary className="flex cursor-pointer list-none items-center gap-2">
                  <span className="font-semibold text-slate-100/90">{event.toolName}</span>
                  {scope ? (
                    <span className="rounded-full border border-white/15 bg-white/8 px-1.5 py-0.5 text-[10px] text-slate-100/70">
                      {scope}
                    </span>
                  ) : null}
                  <span className={cn('font-medium', eventColor(event.status))}>{event.status}</span>
                  <span className="ml-auto text-slate-100/55">{new Date(event.at).toLocaleTimeString()}</span>
                </summary>
                <div className="mt-2 grid gap-2">
                  {event.input !== undefined ? (
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-100/65">Input</div>
                      <JsonViewer
                        value={event.input}
                        className="vacp-chat-json-view mt-1 p-2"
                        expandDepth={1}
                        scrollable={false}
                      />
                    </div>
                  ) : null}
                  {event.output !== undefined ? (
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-100/65">Output</div>
                      <JsonViewer
                        value={event.output}
                        className="vacp-chat-json-view mt-1 p-2"
                        expandDepth={1}
                        scrollable={false}
                      />
                    </div>
                  ) : null}
                  {event.error ? (
                    <div className="rounded-md border border-rose-300/25 bg-rose-500/10 px-2 py-1 text-rose-100/90">
                      {event.error}
                    </div>
                  ) : null}
                </div>
              </details>
            );
          })}
      </div>
    </section>
  );
}
