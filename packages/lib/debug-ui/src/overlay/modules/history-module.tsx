import type { VacpHistoryEntry } from '@vacp/core';
import { PanelRightClose, PanelRightOpen, Redo2, Undo2 } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';

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

function stateFromEntry(entry: VacpHistoryEntry): unknown {
  return entry.state ?? entry.afterState ?? entry.beforeState ?? null;
}

function findPrevIndexWithState(history: VacpHistoryEntry[], startIdx: number): number | null {
  for (let i = Math.min(startIdx, history.length - 1); i >= 0; i--) {
    if (stateFromEntry(history[i])) return i;
  }
  return null;
}

function findNextIndexWithState(history: VacpHistoryEntry[], startIdx: number): number | null {
  for (let i = Math.max(0, startIdx); i < history.length; i++) {
    if (stateFromEntry(history[i])) return i;
  }
  return null;
}

export function HistoryModule(props: VacpDebugModuleProps): ReactElement {
  const history = props.runtime.history ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(history.at(-1)?.id ?? null);
  const selected = useMemo(() => history.find((h) => h.id === selectedId) ?? null, [history, selectedId]);
  const detailsOpen = useVacpDebugUiStore((s) => s.historyDetailsOpen);
  const setDetailsOpen = useVacpDebugUiStore((s) => s.setHistoryDetailsOpen);

  const setCursor = (cursor: number) => props.bridge.setCursor?.(cursor, { source: 'debug', message: `cursor=${cursor}` });
  const undo = () => props.bridge.undo?.({ source: 'debug', message: 'undo' });
  const redo = () => props.bridge.redo?.({ source: 'debug', message: 'redo' });

  const cursorIdx = Number.isFinite(props.runtime.cursor) ? props.runtime.cursor : -1;
  const cursorEntry = cursorIdx >= 0 && cursorIdx < history.length ? history[cursorIdx] : null;

  useEffect(() => {
    // Keep the selected row in sync with the runtime cursor for time travel.
    if (props.runtime.mode === 'inspect' && cursorEntry) {
      setSelectedId(cursorEntry.id);
      return;
    }
    // In live mode, default to the latest entry.
    if (props.runtime.mode === 'live') {
      setSelectedId(history.at(-1)?.id ?? null);
    }
  }, [props.runtime.mode, cursorEntry?.id, history.length]);

  const canUndo = findPrevIndexWithState(history, cursorIdx - 1) !== null;
  const canRedo = findNextIndexWithState(history, cursorIdx + 1) !== null;

  const cursorTargetForIndex = (idx: number): number | null => {
    if (idx < 0 || idx >= history.length) return null;
    if (stateFromEntry(history[idx])) return idx;
    const prev = findPrevIndexWithState(history, idx);
    if (prev !== null) return prev;
    const next = findNextIndexWithState(history, idx);
    if (next !== null) return next;
    return null;
  };

  return (
    <div className={['grid h-full min-h-0 gap-3', detailsOpen ? 'lg:grid-cols-[1fr_420px]' : ''].join(' ')}>
      <Card className="flex min-h-0 flex-col">
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>History</CardTitle>
            <CardDescription>Toggle the Mode button (top bar) to Inspect, then click an entry to move the cursor.</CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <IconButton icon={<Undo2 className="h-4 w-4 text-slate-100/90" />} label="Undo" title="Undo." disabled={!canUndo} onClick={() => undo()} />
            <IconButton icon={<Redo2 className="h-4 w-4 text-slate-100/90" />} label="Redo" title="Redo." disabled={!canRedo} onClick={() => redo()} />
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
              const isCursor = props.runtime.mode === 'inspect' && i === cursorIdx;
              const hasState = Boolean(stateFromEntry(h));
              return (
                <div
                  key={h.id}
                  className={[
                    'rounded-lg border px-2 py-2 text-xs',
                    active ? 'border-sky-300/30 bg-sky-500/10' : 'border-transparent hover:border-white/10 hover:bg-white/5',
                    isCursor ? 'shadow-[inset_0_0_0_1px_rgba(125,211,252,0.20)]' : '',
                  ].join(' ')}
                  aria-selected={active ? 'true' : 'false'}
                  data-role={h.source}
                  data-vacp-row="history-entry"
                  data-index={i}
                  data-has-state={hasState ? 'true' : 'false'}
                  onClick={() => {
                    setSelectedId(h.id);
                    if (props.runtime.mode !== 'inspect') return;
                    const target = cursorTargetForIndex(i);
                    if (target === null) return;
                    setCursor(target);
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${roleDotClass(h.source)}`} aria-hidden="true" title={h.source} />
                    <div className="font-semibold text-slate-100/90">{h.kind}</div>
                    <div className="text-[11px] text-slate-100/60">{formatTime(h.at)}</div>
                    {isCursor ? (
                      <span className="rounded-full border border-sky-300/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold text-sky-100/85">
                        cursor
                      </span>
                    ) : null}
                    {!hasState ? (
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-slate-100/60">
                        event
                      </span>
                    ) : null}
                    <div className="flex-1" />
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
