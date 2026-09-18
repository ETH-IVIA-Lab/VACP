import type { VacpActionCall, VacpActionDescriptor, VacpActionResult } from '@vacp/protocol';
import { ClipboardCopy, FileJson2, Play, RefreshCw, RotateCcw } from 'lucide-react';
import type { ReactElement } from 'react';
import { useMemo, useRef, useState } from 'react';

import { IconButton } from '@vacp/inspector/overlay/icon-button';
import { INSPECTOR_PANEL_BREAKPOINTS, isDenseInspectorPanel } from '@vacp/inspector/overlay/inspector-breakpoints';
import { useElementSize } from '@vacp/inspector/overlay/hooks/use-element-size';
import { Input } from '@vacp/inspector/ui/components/ui/input';
import { JsonValueEditor } from '@vacp/inspector/ui/components/ui/json-editor';
import { stringifyJson } from '@vacp/inspector/ui/components/ui/json-theme';
import { JsonViewer } from '@vacp/inspector/ui/components/ui/json-viewer';
import { RovingFocusGroup, RovingFocusGroupItem } from '@vacp/inspector/ui/components/ui/roving-focus';
import { copyTextToClipboard } from '@vacp/inspector/ui/lib/clipboard';
import { cn } from '@vacp/inspector/ui/lib/utils';

import { createActionParamDraft, validateActionParams, type ActionParamIssue } from './action-params';
import { executeInspectorAction } from './action-execution';
import { ModuleEmptyState, ModuleField, ModuleHeader, ModulePane, ModuleRoot } from './module-layout';
import type { VacpInspectorModuleProps } from './module-types';

export function ActionsModule(props: VacpInspectorModuleProps): ReactElement {
  const graph = props.runtime.currentCapabilities.graph;
  const scope = `${props.runtime.sessionKey ?? props.runtime.runtimeId}:${graph.actions.map((action) => action.name).join('|')}`;
  return <ActionEditor key={scope} {...props} />;
}

function ActionEditor(props: VacpInspectorModuleProps): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rootSize = useElementSize(rootRef);
  const showTwoCols = rootSize.width >= INSPECTOR_PANEL_BREAKPOINTS.splitPane;
  const stacked = !showTwoCols;
  const compactControls = rootSize.width < INSPECTOR_PANEL_BREAKPOINTS.compactControls;
  const dense = isDenseInspectorPanel(rootSize.width, rootSize.height);
  const compactHeader = compactControls && !stacked;
  const boundWide = rootSize.width >= INSPECTOR_PANEL_BREAKPOINTS.splitPane;
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

  const [paramsByAction, setParamsByAction] = useState<Record<string, unknown>>({});
  const [paramsError, setParamsError] = useState<string | null>(null);
  const [result, setResult] = useState<VacpActionResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const selectedDraft = useMemo(
    () => (selected ? createActionParamDraft(selected, props.runtime.currentState.state) : null),
    [props.runtime.currentState.state, selected],
  );

  const paramsValue =
    selected && Object.hasOwn(paramsByAction, selected.name)
      ? paramsByAction[selected.name]
      : (selectedDraft?.params ?? {});

  const paramIssues = useMemo(
    () => (selected ? validateActionParams(selected, paramsValue) : []),
    [paramsValue, selected],
  );

  const selectAction = (action: VacpActionDescriptor) => {
    if (selected && (paramsError || paramIssues.length)) {
      setParamsByAction((previous) => {
        const { [selected.name]: _discard, ...remaining } = previous;
        return remaining;
      });
    }
    setSelectedName(action.name);
    setParamsError(null);
    setResult(null);
    setStatus('idle');
    setError(null);
  };

  const setActionParams = (next: unknown) => {
    if (selected) setParamsByAction((previous) => ({ ...previous, [selected.name]: next }));
  };

  const resetParamsToDraft = () => {
    if (!selected || !selectedDraft) return;
    setParamsByAction((previous) => {
      const { [selected.name]: _discard, ...remaining } = previous;
      return remaining;
    });
    setParamsError(null);
    setResult(null);
    setStatus('idle');
    setError(null);
  };

  const run = async () => {
    if (!selected) return;
    setError(null);
    setResult(null);

    if (paramsError) {
      setStatus('error');
      setError(`Invalid JSON params: ${paramsError}`);

      return;
    }

    if (paramIssues.length) {
      setStatus('error');
      setError(`Fix params before running: ${paramIssues.map((issue) => `${issue.path}: ${issue.message}`).join(' ')}`);

      return;
    }

    const call: VacpActionCall = { callId: crypto.randomUUID(), name: selected.name, params: paramsValue };

    try {
      // Executing actions mutates the live app, keep the inspector in live mode so changes are visible.
      if (props.runtime.mode === 'inspect' && typeof props.bridge.setMode === 'function') {
        props.bridge.setMode('live', { source: 'inspector', message: 'auto: back to live for action' });
      }

      setStatus('running');
      const res = await executeInspectorAction(props.bridge, call, { source: 'inspector' });
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
    await props.bridge.refresh({ source: 'inspector', message: 'refresh' });
  };

  return (
    <ModuleRoot
      rootRef={rootRef}
      boundWide={boundWide}
      className={cn(
        'h-full min-h-0 min-w-0',
        dense ? 'gap-2' : 'gap-3',
        showTwoCols
          ? 'grid overflow-hidden grid-cols-[minmax(260px,0.92fr)_minmax(320px,1.08fr)]'
          : 'flex flex-col overflow-y-auto',
      )}
    >
      <ModulePane
        className={cn(
          'flex min-h-0 min-w-0 overflow-hidden flex-col',
          stacked && 'shrink-0',
          dense ? 'gap-2' : 'gap-3',
        )}
      >
        <ModuleHeader
          title="Action list"
          description="Filter the semantic action surface."
          compact={compactHeader}
          actions={
            <IconButton
              icon={<RefreshCw className="h-4 w-4 text-neutral-100/90" />}
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

        <ModulePane tone="surface" className={cn('min-h-0 overflow-auto', stacked ? 'max-h-20 shrink-0' : 'flex-1')}>
          <RovingFocusGroup orientation="vertical" loop asChild>
            <div className="p-1" role="group" aria-label="Actions">
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
                      aria-pressed={active ? 'true' : 'false'}
                      onClick={() => selectAction(a)}
                    >
                      <div className="break-words font-semibold text-neutral-100/90">{a.name}</div>
                      {a.description ? (
                        <div className="mt-1 text-[11px] text-neutral-100/70">{a.description}</div>
                      ) : null}
                    </button>
                  </RovingFocusGroupItem>
                );
              })}
            </div>
          </RovingFocusGroup>
        </ModulePane>
      </ModulePane>

      <ModulePane
        className={cn(
          'flex min-h-0 min-w-0 flex-col',
          showTwoCols ? 'overflow-hidden' : 'shrink-0 overflow-visible',
          dense ? 'gap-2' : 'gap-3',
        )}
      >
        <ModuleHeader
          title={selected ? selected.name : 'Select an action'}
          description={
            selected?.description ?? 'Choose an action from the list to inspect its parameters and latest result.'
          }
          compact={compactHeader}
          actions={
            <>
              <IconButton
                icon={<Play className="h-4 w-4 text-neutral-100/90" />}
                label="Run action"
                title="Execute this action with the current JSON params."
                variant="primary"
                size={iconButtonSize}
                onClick={() => void run()}
              />
              <IconButton
                icon={<RotateCcw className="h-4 w-4 text-neutral-100/90" />}
                label="Use default params"
                title="Replace params with a draft inferred from the current state and schema."
                size={iconButtonSize}
                onClick={resetParamsToDraft}
              />
              <IconButton
                icon={<ClipboardCopy className="h-4 w-4 text-neutral-100/90" />}
                label="Copy result"
                title="Copy the last result JSON to clipboard."
                size={iconButtonSize}
                onClick={() => void copyTextToClipboard(stringifyJson(result))}
              />
            </>
          }
        />

        <div
          className={cn(
            'grid',
            showTwoCols ? 'min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden' : 'shrink-0',
            dense ? 'gap-2' : 'gap-3',
          )}
        >
          {stacked ? <ActionResultField result={result} status={status} error={error} /> : null}
          <ActionParamGuidance draftSummary={selectedDraft?.summary ?? ''} issues={paramIssues} />
          <ModuleField
            label="Params (JSON)"
            labelId="vacp-action-params-label"
            className={cn(showTwoCols && 'flex min-h-0 flex-col')}
            innerClassName={cn(showTwoCols && 'min-h-0 flex-1')}
          >
            <JsonValueEditor
              id="vacp-action-params"
              labelledBy="vacp-action-params-label"
              value={paramsValue}
              onChange={setActionParams}
              onValidityChange={setParamsError}
              className={cn(showTwoCols && 'h-full')}
              minHeightClassName={stacked ? 'min-h-[84px]' : dense ? 'min-h-[112px]' : 'min-h-[128px]'}
              documentKey={selected?.name}
            />
          </ModuleField>

          {stacked ? null : <ActionResultField result={result} status={status} error={error} />}
        </div>
      </ModulePane>
    </ModuleRoot>
  );
}

function ActionParamGuidance(props: { draftSummary: string; issues: ActionParamIssue[] }): ReactElement {
  const ready = props.issues.length === 0;

  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2 text-[11px]',
        ready ? 'border-emerald-200/12 bg-emerald-300/[0.045]' : 'border-amber-200/14 bg-amber-300/[0.06]',
      )}
      data-vacp-action-param-guidance="1"
    >
      <div className={cn('font-semibold', ready ? 'text-emerald-50/86' : 'text-amber-50/90')}>
        {ready ? 'Ready to run' : 'Fix params before running'}
      </div>
      {props.draftSummary ? <div className="mt-0.5 text-neutral-100/62">{props.draftSummary}</div> : null}
      {props.issues.length ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-amber-50/82">
          {props.issues.map((issue) => (
            <li key={`${issue.path}:${issue.message}`}>
              <code className="rounded bg-black/18 px-1 py-0.5 text-[10px] text-amber-50/88">{issue.path}</code>{' '}
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ActionResultField(props: {
  result: VacpActionResult | null;
  status: 'idle' | 'running' | 'error';
  error: string | null;
}): ReactElement {
  return (
    <ModuleField label="Result" className="min-h-0 shrink-0">
      <div data-vacp-action-result="1" className="min-h-0">
        {props.result || props.status !== 'idle' ? (
          <JsonViewer
            value={props.result}
            emptyText={
              props.status === 'running'
                ? 'Running...'
                : props.status === 'error'
                  ? (props.error ?? 'Action failed')
                  : ''
            }
            className="min-h-0 max-h-[260px]"
          />
        ) : (
          <ModuleEmptyState className="flex min-h-[56px] items-center justify-center gap-3 rounded-lg border border-dashed border-white/[0.08] bg-white/[0.018] px-4 py-2 text-left">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-teal-200/14 bg-teal-300/[0.06] text-teal-50/72">
              <FileJson2 className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-[12px] font-semibold text-neutral-100/84">Results will appear here</span>
              <span className="mt-0.5 block max-w-[40ch] text-[11px] text-neutral-100/56">
                Run the selected action to inspect returned JSON.
              </span>
            </span>
          </ModuleEmptyState>
        )}
      </div>
    </ModuleField>
  );
}
