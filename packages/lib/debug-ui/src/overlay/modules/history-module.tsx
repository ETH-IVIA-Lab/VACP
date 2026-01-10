import type { VacpHistoryEntry } from '@vacp/core';
import { Bot, Cpu, PanelRightClose, PanelRightOpen, Redo2, Undo2, User, Wrench } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { IconButton } from '@vacp/debug-ui/overlay/icon-button';
import { useVacpDebugUiStore } from '@vacp/debug-ui/overlay/debug-store';
import { useElementSize } from '@vacp/debug-ui/overlay/hooks/use-element-size';
import { Card, CardDescription, CardHeader, CardTitle } from '@vacp/debug-ui/ui/components/ui/card';
import { JsonViewer } from '@vacp/debug-ui/ui/components/ui/json-viewer';
import { RovingFocusGroup, RovingFocusGroupItem } from '@vacp/debug-ui/ui/components/ui/roving-focus';
import { cn } from '@vacp/debug-ui/ui/lib/utils';

import type { VacpDebugModuleProps } from './module-types';

function formatTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString();
}

function roleInfo(source: VacpHistoryEntry['source']): {
  dotClass: string;
  label: string;
  description: string;
  icon: ReactElement;
} {
  if (source === 'human') {
    return {
      dotClass: 'bg-sky-300',
      label: 'Human',
      description: 'Direct user interaction (mouse/keyboard) in the host app.',
      icon: <User className="h-3.5 w-3.5 text-sky-100/90" aria-hidden="true" />,
    };
  }
  if (source === 'agent') {
    return {
      dotClass: 'bg-violet-300',
      label: 'Agent',
      description: 'AI-driven action (playbook step or tool invocation).',
      icon: <Bot className="h-3.5 w-3.5 text-violet-100/90" aria-hidden="true" />,
    };
  }
  if (source === 'debug') {
    return {
      dotClass: 'bg-amber-300',
      label: 'Debug UI',
      description: 'Triggered by the debug overlay (History/Actions/JSON/Data modules).',
      icon: <Wrench className="h-3.5 w-3.5 text-amber-100/90" aria-hidden="true" />,
    };
  }
  // `system` or unknown: runtime/provider/internal events.
  return {
    dotClass: 'bg-white/40',
    label: 'System',
    description: 'Provider/runtime/internal events (refresh, mode changes, observers).',
    icon: <Cpu className="h-3.5 w-3.5 text-slate-100/80" aria-hidden="true" />,
  };
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rootSize = useElementSize(rootRef);
  const compactControls = rootSize.width < 520;
  const dense = rootSize.width < 520 || rootSize.height < 360;
  const iconButtonSize = 'iconSm';
  const effectiveDetailsOpen = detailsOpen && !dense;
  const showSideBySide = effectiveDetailsOpen && rootSize.width >= 900;
  const stackLegend = rootSize.width < 640;

  useEffect(() => {
    if (!dense || !detailsOpen) return;
    setDetailsOpen(false);
  }, [dense, detailsOpen, setDetailsOpen]);

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
    <div
      ref={rootRef}
      className={cn(
        'h-full min-h-0',
        dense ? 'gap-2' : 'gap-3',
        showSideBySide ? 'grid grid-cols-[minmax(0,1fr)_minmax(320px,420px)]' : 'flex flex-col',
      )}
    >
      <Card className={cn('flex min-h-0 flex-1 flex-col', dense && 'p-2')}>
        <CardHeader className={cn('items-start', compactControls && 'flex-col items-stretch gap-2')}>
          <div className="min-w-0 flex-1">
            <CardTitle>History</CardTitle>
            <CardDescription>Toggle the Mode button (top bar) to Inspect, then click an entry to move the cursor.</CardDescription>
            {dense ? (
              <details className="mt-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-slate-100/80">
                <summary className="cursor-pointer select-none font-medium text-slate-100/85">Sources legend</summary>
                <div className="mt-2 flex flex-wrap items-center gap-2.5">
                  {(['human', 'agent', 'debug', 'system'] as const).map((source) => {
                    const info = roleInfo(source as any);
                    return (
                      <span
                        key={source}
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-2.5 py-1.5 leading-none"
                        title={info.description}
                      >
                        <span className={cn('h-2 w-2 rounded-full', info.dotClass)} aria-hidden="true" />
                        {info.icon}
                        <span className="font-medium text-slate-100/80">{info.label}</span>
                      </span>
                    );
                  })}
                </div>
              </details>
            ) : (
              <div
                className={cn(
                  'mt-2 gap-2.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-slate-100/80',
                  stackLegend ? 'flex flex-col items-stretch' : 'flex flex-wrap items-center',
                )}
              >
                <span className="inline-flex items-center rounded-md border border-white/10 bg-black/20 px-2 py-1 font-medium text-slate-100/80">
                  Sources
                </span>
                {(['human', 'agent', 'debug', 'system'] as const).map((source) => {
                  const info = roleInfo(source as any);
                  return (
                    <span
                      key={source}
                      className={cn(
                        'inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-2.5 py-1.5 leading-none',
                        stackLegend && 'w-full',
                      )}
                      title={info.description}
                    >
                      <span className={cn('h-2 w-2 rounded-full', info.dotClass)} aria-hidden="true" />
                      {info.icon}
                      <span className="font-medium text-slate-100/80">{info.label}</span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
          <div
            className={cn(
              'flex items-center gap-2',
              compactControls
                ? 'w-full flex-nowrap justify-start overflow-x-auto gap-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
                : 'shrink-0',
            )}
          >
            <IconButton icon={<Undo2 className="h-4 w-4 text-slate-100/90" />} size={iconButtonSize} label="Undo" title="Undo." disabled={!canUndo} onClick={() => undo()} />
            <IconButton icon={<Redo2 className="h-4 w-4 text-slate-100/90" />} size={iconButtonSize} label="Redo" title="Redo." disabled={!canRedo} onClick={() => redo()} />
            <IconButton
              icon={detailsOpen ? <PanelRightClose className="h-4 w-4 text-slate-100/90" /> : <PanelRightOpen className="h-4 w-4 text-slate-100/90" />}
              size={iconButtonSize}
              label={detailsOpen ? 'Hide details pane' : 'Show details pane'}
              title={detailsOpen ? 'Hide the Details pane to give the history list more space.' : 'Show the Details pane.'}
              pressed={effectiveDetailsOpen}
              onClick={() => setDetailsOpen(!detailsOpen)}
            />
          </div>
        </CardHeader>

        <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-lg border border-white/10 bg-black/20">
          <RovingFocusGroup orientation="vertical" loop asChild>
            <div className="p-1" role="listbox" aria-label="History entries">
              {history.map((h, i) => {
                const active = h.id === selectedId;
                const isCursor = props.runtime.mode === 'inspect' && i === cursorIdx;
                const hasState = Boolean(stateFromEntry(h));
                const info = roleInfo(h.source);
                return (
                  <RovingFocusGroupItem key={h.id} asChild>
                    <button
                      type="button"
                      className={cn(
                        'w-full rounded-lg border px-2 py-2 text-left text-xs transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60',
                        active
                          ? 'border-sky-300/30 bg-sky-500/10'
                          : 'border-transparent hover:border-white/10 hover:bg-white/5',
                        isCursor ? 'shadow-[inset_0_0_0_1px_rgba(125,211,252,0.20)]' : '',
                      )}
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
                        <span className={cn('h-2 w-2 rounded-full', info.dotClass)} aria-hidden="true" title={info.label} />
                        <span className="inline-flex items-center gap-1" title={info.description}>
                          {info.icon}
                          <span className="sr-only">{info.label}</span>
                        </span>
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
                    </button>
                  </RovingFocusGroupItem>
                );
              })}
            </div>
          </RovingFocusGroup>
        </div>
      </Card>

      {effectiveDetailsOpen ? (
        <Card className={cn('flex min-h-0 flex-col', !showSideBySide && 'max-h-[45%]', dense && 'p-2')}>
          <CardHeader>
            <div className="min-w-0">
              <CardTitle>Details</CardTitle>
              <CardDescription>
                {selected
                  ? `${selected.kind} • ${roleInfo(selected.source).label}`
                  : 'Select an entry to inspect.'}
              </CardDescription>
            </div>
          </CardHeader>
          <JsonViewer value={selected} className={cn('flex-1', dense && 'p-2')} />
        </Card>
      ) : null}
    </div>
  );
}
