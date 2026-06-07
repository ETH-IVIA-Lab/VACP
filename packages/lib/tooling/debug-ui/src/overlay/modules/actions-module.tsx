import type { VacpActionCall, VacpActionDescriptor, VacpActionResult } from '@vacp/core';
import { ClipboardCopy, FileJson2, Play, RefreshCw } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { IconButton } from '@vacp/debug-ui/overlay/icon-button';
import { DEBUG_UI_PANEL_BREAKPOINTS, isDenseDebugPanel } from '@vacp/debug-ui/overlay/debug-ui-breakpoints';
import { useElementSize } from '@vacp/debug-ui/overlay/hooks/use-element-size';
import { Input } from '@vacp/debug-ui/ui/components/ui/input';
import { JsonViewer } from '@vacp/debug-ui/ui/components/ui/json-viewer';
import { RovingFocusGroup, RovingFocusGroupItem } from '@vacp/debug-ui/ui/components/ui/roving-focus';
import { Textarea } from '@vacp/debug-ui/ui/components/ui/textarea';
import { copyTextToClipboard } from '@vacp/debug-ui/ui/lib/clipboard';
import { cn } from '@vacp/debug-ui/ui/lib/utils';

import { ModuleEmptyState, ModuleField, ModuleHeader, ModulePane, ModuleRoot } from './module-layout';
import type { VacpDebugModuleProps } from './module-types';

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseJson(text: string): unknown {
  const t = text.trim();
  if (!t) return undefined;
  return JSON.parse(t);
}

export function ActionsModule(props: VacpDebugModuleProps): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rootSize = useElementSize(rootRef);
  const showTwoCols = rootSize.width >= DEBUG_UI_PANEL_BREAKPOINTS.splitPane;
  const compactControls = rootSize.width < DEBUG_UI_PANEL_BREAKPOINTS.compactControls;
  const dense = isDenseDebugPanel(rootSize.width, rootSize.height);
  const boundWide = rootSize.width >= DEBUG_UI_PANEL_BREAKPOINTS.splitPane;
  const iconButtonSize = 'iconSm';
  const actions = props.runtime.currentCapabilities.graph.actions ?? [];
  const [filter, setFilter] = useState('');
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => a.name.toLowerCase().includes(q) || (a.description ?? '').toLowerCase().includes(q));
  }, [actions, filter]);

  const [selectedName, setSelectedName] = useState<string>(actions[0]?.name ?? '');
  const selected: VacpActionDescriptor | null = useMemo(
    () => actions.find((a) => a.name === selectedName) ?? actions[0] ?? null,
    [actions, selectedName],
  );

  const [paramsText, setParamsText] = useState<string>('{}');
  const [result, setResult] = useState<VacpActionResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selected) return;
    setSelectedName(selected.name);
    setParamsText('{}');
    setResult(null);
    setStatus('idle');
    setError(null);
  }, [selected?.name]);

  const run = async () => {
    if (!selected) return;
    // Executing actions mutates the live app; keep the debug UI in live mode so changes are visible.
    if (props.runtime.mode === 'inspect' && typeof props.bridge.setMode === 'function') {
      props.bridge.setMode('live', { source: 'debug', message: 'auto: back to live for action' });
    }
    setStatus('running');
    setError(null);
    setResult(null);
    let params: unknown;
    try {
      params = parseJson(paramsText);
    } catch (err) {
      setStatus('error');
      setError(`Invalid JSON params: ${String(err)}`);
      return;
    }

    const call: VacpActionCall = { callId: crypto.randomUUID(), name: selected.name, params };
    try {
      const res =
        typeof props.bridge.dispatch === 'function'
          ? await props.bridge.dispatch(call, { source: 'debug' })
          : await props.bridge.execute(call);
      setResult(res);
      setStatus(res.ok ? 'idle' : 'error');
      if (!res.ok) setError(res.error?.message ?? 'Action failed');
    } catch (err) {
      setStatus('error');
      setError(String(err));
    }
  };

  const refresh = async () => {
    if (typeof props.bridge.refresh !== 'function') return;
    await props.bridge.refresh({ source: 'debug', message: 'refresh' });
  };

  return (
    <ModuleRoot
      rootRef={rootRef}
      boundWide={boundWide}
      className={cn(
        'grid h-full min-h-0 overflow-hidden',
        dense ? 'gap-2' : 'gap-3',
        showTwoCols ? 'grid-cols-2' : 'grid-rows-[minmax(150px,0.78fr)_minmax(0,1.22fr)]',
      )}
    >
      <ModulePane className={cn('flex min-h-0 flex-col', dense ? 'gap-2' : 'gap-3')}>
        <ModuleHeader
          title="Action list"
          description="Filter the semantic action surface."
          compact={compactControls}
          actions={
            <IconButton
              icon={<RefreshCw className="h-4 w-4 text-slate-100/90" />}
              label="Refresh snapshots"
              title="Ask the provider to refresh its state snapshot."
              size={iconButtonSize}
              onClick={() => void refresh()}
            />
          }
        />

        <ModuleField label="Filter" htmlFor="vacp-action-filter">
          <Input
            id="vacp-action-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search actions by name or description"
          />
        </ModuleField>

        <ModulePane tone="surface" className="min-h-0 flex-1 overflow-auto">
          <RovingFocusGroup orientation="vertical" loop asChild>
            <div className="p-1" role="listbox" aria-label="Actions">
              {filtered.map((a) => {
                const active = a.name === (selected?.name ?? '');
                return (
                  <RovingFocusGroupItem key={a.name} asChild>
                    <button
                      type="button"
                      className={cn(
                        'w-full rounded-md px-2 py-2 text-left text-xs transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30',
                        'hover:bg-white/[0.045]',
                        active ? 'border border-white/12 bg-white/[0.07]' : 'border border-transparent',
                      )}
                      aria-selected={active ? 'true' : 'false'}
                      onClick={() => setSelectedName(a.name)}
                    >
                      <div className="break-words font-semibold text-slate-100/90">{a.name}</div>
                      {a.description ? <div className="mt-1 text-[11px] text-slate-100/70">{a.description}</div> : null}
                    </button>
                  </RovingFocusGroupItem>
                );
              })}
            </div>
          </RovingFocusGroup>
        </ModulePane>
      </ModulePane>

      <ModulePane className={cn('flex min-h-0 flex-col', dense ? 'gap-2' : 'gap-3')}>
        <ModuleHeader
          title={selected ? selected.name : 'Select an action'}
          description={
            selected?.description ?? 'Choose an action from the list to inspect its parameters and latest result.'
          }
          compact={compactControls}
          actions={
            <>
              <IconButton
                icon={<Play className="h-4 w-4 text-slate-100/90" />}
                label="Run action"
                title="Execute this action with the current JSON params."
                variant="primary"
                size={iconButtonSize}
                onClick={() => void run()}
              />
              <IconButton
                icon={<ClipboardCopy className="h-4 w-4 text-slate-100/90" />}
                label="Copy result"
                title="Copy the last result JSON to clipboard."
                size={iconButtonSize}
                onClick={() => void copyTextToClipboard(safeJson(result))}
              />
            </>
          }
        />

        <div className={cn('grid min-h-0 flex-1', dense ? 'gap-2' : 'gap-3')}>
          <ModuleField label="Params (JSON)" htmlFor="vacp-action-params">
            <Textarea
              id="vacp-action-params"
              className="min-h-[140px]"
              value={paramsText}
              onChange={(e) => setParamsText(e.target.value)}
            />
          </ModuleField>

          <ModuleField label="Result" className="min-h-0">
            {result || status !== 'idle' ? (
              <JsonViewer
                value={result}
                emptyText={status === 'running' ? 'Running...' : status === 'error' ? (error ?? 'Action failed') : ''}
                className="min-h-0 max-h-[360px]"
              />
            ) : (
              <ModuleEmptyState className="flex min-h-[62px] items-center justify-center gap-3 rounded-lg border border-dashed border-white/[0.08] bg-white/[0.018] px-4 py-2 text-left">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-teal-200/14 bg-teal-300/[0.06] text-teal-50/72">
                  <FileJson2 className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[12px] font-semibold text-slate-100/84">Results will appear here</span>
                  <span className="mt-0.5 block max-w-[40ch] text-[11px] text-slate-100/56">
                    Run the selected action to inspect returned JSON.
                  </span>
                </span>
              </ModuleEmptyState>
            )}
          </ModuleField>
        </div>
      </ModulePane>
    </ModuleRoot>
  );
}
