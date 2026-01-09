import type { VacpHistoryEntry, VacpRuntimeMode } from '@vacp/core';
import { Eye, EyeOff, PanelRightClose, PanelRightOpen, Redo2, Rewind, Undo2 } from 'lucide-react';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';

import { IconButton } from '@vacp/debug-ui/overlay/icon-button';
import { useVacpDebugUiStore } from '@vacp/debug-ui/overlay/debug-store';
import { Card, CardDescription, CardHeader, CardTitle } from '@vacp/debug-ui/ui/components/ui/card';

import type { VacpDebugModuleProps } from './module-types';

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString();
}

function roleDotClass(source: VacpHistoryEntry['source']): string {
  if (source === 'human') return 'bg-sky-300';
  if (source === 'agent') return 'bg-violet-300';
  if (source === 'debug') return 'bg-amber-300';
  return 'bg-white/40';
}

export function HistoryModule(props: VacpDebugModuleProps): ReactElement {
  const history = props.runtime.history ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(history.at(-1)?.id ?? null);
  const selected = useMemo(() => history.find((h) => h.id === selectedId) ?? null, [history, selectedId]);
  const detailsOpen = useVacpDebugUiStore((s) => s.historyDetailsOpen);
  const setDetailsOpen = useVacpDebugUiStore((s) => s.setHistoryDetailsOpen);

  const setMode = (mode: VacpRuntimeMode) => props.bridge.setMode?.(mode, { source: 'debug', message: `mode=${mode}` });
  const setCursor = (cursor: number) => props.bridge.setCursor?.(cursor, { source: 'debug', message: `cursor=${cursor}` });
  const undo = () => props.bridge.undo?.({ source: 'debug', message: 'undo' });
  const redo = () => props.bridge.redo?.({ source: 'debug', message: 'redo' });

  return (
    <div className={['grid h-full min-h-0 gap-3', detailsOpen ? 'lg:grid-cols-[1fr_420px]' : ''].join(' ')}>
      <Card className="flex min-h-0 flex-col">
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>History</CardTitle>
            <CardDescription>Inspect snapshots and action results. Switch to inspect mode to time travel.</CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <IconButton icon={<Eye className="h-4 w-4 text-slate-100/90" />} label="Live" title="Switch to live mode." pressed={props.runtime.mode === 'live'} onClick={() => setMode('live')} />
            <IconButton
              icon={<EyeOff className="h-4 w-4 text-slate-100/90" />}
              label="Inspect"
              title="Switch to inspect mode (time travel)."
              pressed={props.runtime.mode === 'inspect'}
              onClick={() => setMode('inspect')}
            />
            <IconButton icon={<Undo2 className="h-4 w-4 text-slate-100/90" />} label="Undo" title="Undo." onClick={() => undo()} />
            <IconButton icon={<Redo2 className="h-4 w-4 text-slate-100/90" />} label="Redo" title="Redo." onClick={() => redo()} />
            <IconButton
              icon={detailsOpen ? <PanelRightClose className="h-4 w-4 text-slate-100/90" /> : <PanelRightOpen className="h-4 w-4 text-slate-100/90" />}
              label={detailsOpen ? 'Hide details pane' : 'Show details pane'}
              title={detailsOpen ? 'Hide the Details pane to give the history list more space.' : 'Show the Details pane.'}
              pressed={detailsOpen}
              onClick={() => setDetailsOpen(!detailsOpen)}
            />
          </div>
        </CardHeader>

        <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-lg border border-white/10 bg-black/20">
          <div className="p-1">
            {history.map((h, i) => {
              const active = h.id === selectedId;
              return (
                <div
                  key={h.id}
                  className={[
                    'rounded-lg border px-2 py-2 text-xs',
                    active ? 'border-sky-300/30 bg-sky-500/10' : 'border-transparent hover:border-white/10 hover:bg-white/5',
                  ].join(' ')}
                  aria-selected={active ? 'true' : 'false'}
                  data-role={h.source}
                  onClick={() => setSelectedId(h.id)}
                >
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${roleDotClass(h.source)}`} aria-hidden="true" title={h.source} />
                    <div className="font-semibold text-slate-100/90">{h.kind}</div>
                    <div className="text-[11px] text-slate-100/60">{formatTime(h.at)}</div>
                    <div className="flex-1" />
                    <IconButton
                      icon={<Rewind className="h-4 w-4 text-slate-100/90" />}
                      label="Rewind to here"
                      title="Set the cursor to this entry (inspect mode)."
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => {
                        setMode('inspect');
                        setCursor(i);
                      }}
                    />
                  </div>
                  {h.message ? <div className="mt-2 text-[11px] text-slate-100/70">{h.message}</div> : null}
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {detailsOpen ? (
        <Card className="flex min-h-0 flex-col">
          <CardHeader>
            <div className="min-w-0">
              <CardTitle>Details</CardTitle>
              <CardDescription>{selected ? `${selected.kind} • ${selected.source}` : 'Select an entry to inspect.'}</CardDescription>
            </div>
          </CardHeader>
          <pre className="min-h-0 flex-1 overflow-auto rounded-lg border border-white/10 bg-black/20 p-3 text-[12px] leading-5 text-slate-100/85">
            {safeJson(selected)}
          </pre>
        </Card>
      ) : null}
    </div>
  );
}
