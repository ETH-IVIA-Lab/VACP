import type { VacpChangeSource, VacpHistoryEntry } from '@vacp/protocol';
import {
  Bot,
  Cpu,
  Eye,
  PanelRightClose,
  PanelRightOpen,
  Radio,
  Redo2,
  RotateCcw,
  Undo2,
  User,
  Wrench,
} from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { INSPECTOR_PANEL_BREAKPOINTS, isDenseInspectorPanel } from '@vacp/inspector/overlay/inspector-breakpoints';
import { IconButton } from '@vacp/inspector/overlay/icon-button';
import { useVacpInspectorStore } from '@vacp/inspector/overlay/inspector-store';
import { useElementSize } from '@vacp/inspector/overlay/hooks/use-element-size';
import { JsonViewer } from '@vacp/inspector/ui/components/ui/json-viewer';
import { RovingFocusGroup, RovingFocusGroupItem } from '@vacp/inspector/ui/components/ui/roving-focus';
import { cn } from '@vacp/inspector/ui/lib/utils';

import { ModuleHeader, ModulePane, ModuleRoot, ModuleSubheader } from './module-layout';
import type { VacpInspectorModuleProps } from './module-types';

const HISTORY_SOURCES = ['human', 'agent', 'inspector', 'system'] as const satisfies readonly VacpChangeSource[];

function formatTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);

  if (Number.isNaN(d.getTime())) return iso;

  return d.toLocaleTimeString();
}

function roleInfo(source: VacpHistoryEntry['source']): {
  chipClass: string;
  dotClass: string;
  rowAccentClass: string;
  label: string;
  description: string;
  icon: ReactElement;
} {
  if (source === 'human') {
    return {
      chipClass: 'border-cyan-200/18 bg-cyan-300/[0.045] text-cyan-50/76',
      dotClass: 'bg-cyan-300/78',
      rowAccentClass: 'border-l-cyan-300/42',
      label: 'Human',
      description: 'Direct user interaction (mouse/keyboard) in the host app.',
      icon: <User className="h-3.5 w-3.5 text-cyan-50/72" aria-hidden="true" />,
    };
  }

  if (source === 'agent') {
    return {
      chipClass: 'border-violet-200/18 bg-violet-300/[0.052] text-violet-50/78',
      dotClass: 'bg-violet-300/76',
      rowAccentClass: 'border-l-violet-300/44',
      label: 'Agent',
      description: 'AI-driven action or tool invocation.',
      icon: <Bot className="h-3.5 w-3.5 text-violet-50/72" aria-hidden="true" />,
    };
  }

  if (source === 'inspector') {
    return {
      chipClass: 'border-amber-200/18 bg-amber-300/[0.05] text-amber-50/76',
      dotClass: 'bg-amber-300/78',
      rowAccentClass: 'border-l-amber-300/44',
      label: 'Inspector',
      description: 'Triggered by the inspector (History/Actions/JSON/Data modules).',
      icon: <Wrench className="h-3.5 w-3.5 text-amber-50/72" aria-hidden="true" />,
    };
  }

  return {
    chipClass: 'border-neutral-200/12 bg-white/[0.032] text-neutral-100/62',
    dotClass: 'bg-neutral-300/52',
    rowAccentClass: 'border-l-neutral-300/28',
    label: 'System',
    description: 'Provider/runtime/internal events (refresh, mode changes, observers).',
    icon: <Cpu className="h-3.5 w-3.5 text-neutral-100/68" aria-hidden="true" />,
  };
}

function kindInfo(kind: VacpHistoryEntry['kind']): { chipClass: string; label: string } {
  if (kind === 'snapshot')
    return { chipClass: 'border-cyan-200/14 bg-cyan-300/[0.04] text-cyan-50/70', label: 'snapshot' };

  if (kind === 'action')
    return { chipClass: 'border-violet-200/14 bg-violet-300/[0.045] text-violet-50/72', label: 'action' };

  if (kind === 'state_override')
    return { chipClass: 'border-amber-200/14 bg-amber-300/[0.045] text-amber-50/72', label: 'state' };

  if (kind === 'graph_override')
    return { chipClass: 'border-sky-200/14 bg-sky-300/[0.04] text-sky-50/70', label: 'graph' };

  return { chipClass: 'border-neutral-200/12 bg-white/[0.032] text-neutral-100/62', label: 'mode' };
}

function HistorySourceLegend(props: { stack: boolean }): ReactElement {
  return (
    <div
      className={cn(
        'flex gap-1.5 text-[11px] text-neutral-100/72',
        props.stack ? 'flex-col items-stretch' : 'flex-wrap items-center',
      )}
    >
      <span className="inline-flex items-center rounded-md border border-white/[0.065] bg-white/[0.018] px-2 py-1 font-medium text-neutral-100/62">
        Sources
      </span>
      {HISTORY_SOURCES.map((source) => {
        const info = roleInfo(source);

        return (
          <span
            key={source}
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5 leading-none',
              info.chipClass,
              props.stack && 'w-full',
            )}
            title={info.description}
          >
            <span className={cn('h-2 w-2 rounded-full', info.dotClass)} aria-hidden="true" />
            {info.icon}
            <span className="font-medium">{info.label}</span>
          </span>
        );
      })}
    </div>
  );
}

function stateFromEntry(entry: VacpHistoryEntry) {
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

export function HistoryModule(props: VacpInspectorModuleProps): ReactElement {
  const history = props.runtime.history ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(history.at(-1)?.id ?? null);
  const selected = useMemo(() => history.find((h) => h.id === selectedId) ?? null, [history, selectedId]);
  const detailsOpen = useVacpInspectorStore((s) => s.historyDetailsOpen);
  const setDetailsOpen = useVacpInspectorStore((s) => s.setHistoryDetailsOpen);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rootSize = useElementSize(rootRef);
  const compactControls = rootSize.width < INSPECTOR_PANEL_BREAKPOINTS.compactControls;
  const dense = isDenseInspectorPanel(rootSize.width, rootSize.height);
  const iconButtonSize = 'iconSm';
  const effectiveDetailsOpen = detailsOpen && !dense;
  const showSideBySide = effectiveDetailsOpen && rootSize.width >= INSPECTOR_PANEL_BREAKPOINTS.splitPane;
  const stackLegend = rootSize.width < INSPECTOR_PANEL_BREAKPOINTS.stackLegend;
  const boundWide = rootSize.width >= INSPECTOR_PANEL_BREAKPOINTS.splitPane;

  useEffect(() => {
    if (!dense || !detailsOpen) return;
    setDetailsOpen(false);
  }, [dense, detailsOpen, setDetailsOpen]);

  const setCursor = (cursor: number) =>
    props.bridge.setCursor?.(cursor, { source: 'inspector', message: `cursor=${cursor}` });

  const setLiveMode = () =>
    props.bridge.setMode?.('live', { source: 'inspector', message: 'return to live from history' });

  const undo = () => props.bridge.undo?.({ source: 'inspector', message: 'undo' });
  const redo = () => props.bridge.redo?.({ source: 'inspector', message: 'redo' });

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

  const selectedIdx = selected ? history.findIndex((h) => h.id === selected.id) : -1;
  const selectedCursorTarget = selectedIdx >= 0 ? cursorTargetForIndex(selectedIdx) : null;
  const selectedCanInspect = selectedCursorTarget !== null;

  const inspectSelected = () => {
    if (selectedCursorTarget === null) return;
    setCursor(selectedCursorTarget);
  };

  return (
    <ModuleRoot
      rootRef={rootRef}
      boundWide={boundWide}
      className={cn(
        'h-full min-h-0',
        dense ? 'gap-2' : 'gap-3',
        showSideBySide ? 'grid grid-cols-[minmax(0,1fr)_minmax(320px,420px)]' : 'flex flex-col',
      )}
    >
      <ModulePane className={cn('flex min-h-0 flex-1 flex-col', dense ? 'gap-2' : 'gap-3')}>
        <ModuleHeader
          title="Events"
          description="Select runtime events and replay stateful moments in Inspect mode."
          compact={compactControls}
          actions={
            <>
              <IconButton
                icon={<Undo2 className="h-4 w-4 text-neutral-100/90" />}
                size={iconButtonSize}
                label="Undo"
                title="Undo."
                disabled={!canUndo}
                onClick={() => undo()}
              />
              <IconButton
                icon={<Redo2 className="h-4 w-4 text-neutral-100/90" />}
                size={iconButtonSize}
                label="Redo"
                title="Redo."
                disabled={!canRedo}
                onClick={() => redo()}
              />
              <IconButton
                icon={
                  detailsOpen ? (
                    <PanelRightClose className="h-4 w-4 text-neutral-100/90" />
                  ) : (
                    <PanelRightOpen className="h-4 w-4 text-neutral-100/90" />
                  )
                }
                size={iconButtonSize}
                label={detailsOpen ? 'Hide details pane' : 'Show details pane'}
                title={
                  detailsOpen ? 'Hide the Details pane to give the history list more space.' : 'Show the Details pane.'
                }
                pressed={effectiveDetailsOpen}
                onClick={() => setDetailsOpen(!detailsOpen)}
              />
            </>
          }
        />

        <ModuleSubheader data-vacp-history-subheader="1" role="group" aria-label="History sources">
          {dense ? (
            <details className="text-[11px] text-neutral-100/72">
              <summary className="cursor-pointer select-none font-medium text-neutral-100/78">Sources</summary>
              <HistorySourceLegend stack={false} />
            </details>
          ) : (
            <HistorySourceLegend stack={stackLegend} />
          )}
        </ModuleSubheader>

        <div
          data-vacp-history-mode-strip="1"
          className={cn(
            'flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-[11px]',
            props.runtime.mode === 'inspect'
              ? 'border-amber-200/16 bg-amber-300/[0.055] text-amber-50/82'
              : 'border-emerald-200/14 bg-emerald-300/[0.045] text-emerald-50/78',
            compactControls ? 'flex-col items-stretch' : 'flex-wrap',
          )}
        >
          <span className="inline-flex min-w-0 items-center gap-2 font-medium">
            {props.runtime.mode === 'inspect' ? (
              <Eye className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <Radio className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            )}
            <span className="min-w-0 truncate">
              {props.runtime.mode === 'inspect'
                ? `Inspecting history entry ${cursorIdx >= 0 ? cursorIdx : 'unknown'}`
                : 'Live mode'}
            </span>
          </span>
          <span className="min-w-0 flex-1 text-neutral-100/58">
            {props.runtime.mode === 'inspect'
              ? 'The host app is showing recorded state until you return to live.'
              : 'New app interactions and inspector actions append to history.'}
          </span>
          <button
            type="button"
            className="inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md border border-white/10 bg-white/[0.045] px-2.5 text-[11px] font-semibold text-neutral-100/82 outline-none transition hover:border-white/18 hover:bg-white/[0.075] focus:ring-2 focus:ring-white/28 disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!selectedCanInspect || props.runtime.mode === 'inspect'}
            title={
              selectedCanInspect
                ? 'Inspect the selected stateful history entry.'
                : 'Select an entry with recorded state.'
            }
            onClick={inspectSelected}
          >
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            Inspect selected
          </button>
          <button
            type="button"
            className="inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md border border-white/10 bg-white/[0.045] px-2.5 text-[11px] font-semibold text-neutral-100/82 outline-none transition hover:border-white/18 hover:bg-white/[0.075] focus:ring-2 focus:ring-white/28 disabled:cursor-not-allowed disabled:opacity-45"
            disabled={props.runtime.mode !== 'inspect'}
            onClick={setLiveMode}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Return to Live
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto border-t border-white/[0.075] pt-1">
          <RovingFocusGroup orientation="vertical" loop asChild>
            <div className="p-1" role="group" aria-label="History entries">
              {history.map((h, i) => {
                const active = h.id === selectedId;
                const isCursor = props.runtime.mode === 'inspect' && i === cursorIdx;
                const hasState = Boolean(stateFromEntry(h));
                const info = roleInfo(h.source);
                const kind = kindInfo(h.kind);

                return (
                  <RovingFocusGroupItem key={h.id} asChild>
                    <button
                      type="button"
                      className={cn(
                        'w-full rounded-md border border-l-2 px-2 py-2 text-left text-xs transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30',
                        info.rowAccentClass,
                        active
                          ? 'border-y-white/12 border-r-white/12 bg-white/[0.065]'
                          : 'border-y-transparent border-r-transparent hover:border-y-white/[0.075] hover:border-r-white/[0.075] hover:bg-white/[0.035]',
                        isCursor ? '' : '',
                      )}
                      aria-pressed={active ? 'true' : 'false'}
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
                        <span
                          className={cn('h-2 w-2 rounded-full', info.dotClass)}
                          aria-hidden="true"
                          title={info.label}
                        />
                        <span className="inline-flex items-center gap-1" title={info.description}>
                          {info.icon}
                          <span className="sr-only">{info.label}</span>
                        </span>
                        <div className="font-semibold text-neutral-100/90">{h.kind}</div>
                        <div className="text-[11px] text-neutral-100/60">{formatTime(h.at)}</div>
                        <span
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none',
                            kind.chipClass,
                          )}
                        >
                          {kind.label}
                        </span>
                        {isCursor ? (
                          <span className="rounded-full border border-white/12 bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold text-neutral-100/72">
                            cursor
                          </span>
                        ) : null}
                        {!hasState ? (
                          <span className="rounded-full border border-white/[0.075] bg-white/[0.025] px-2 py-0.5 text-[10px] font-semibold text-neutral-100/54">
                            event
                          </span>
                        ) : null}
                        <div className="flex-1" />
                      </div>
                      {h.message ? <div className="mt-2 text-[11px] text-neutral-100/70">{h.message}</div> : null}
                    </button>
                  </RovingFocusGroupItem>
                );
              })}
            </div>
          </RovingFocusGroup>
        </div>
      </ModulePane>

      {effectiveDetailsOpen ? (
        <ModulePane
          className={cn('flex min-h-0 flex-col', !showSideBySide && 'max-h-[45%]', dense ? 'gap-2' : 'gap-3')}
        >
          <ModuleHeader
            title="Details"
            description={
              selected
                ? `${selected.kind} / ${roleInfo(selected.source).label}`
                : 'Select an entry to inspect the recorded payload.'
            }
          />
          <JsonViewer value={selected} className={cn('flex-1', dense && 'p-2')} />
        </ModulePane>
      ) : null}
    </ModuleRoot>
  );
}
