import type { VacpActionCall, VacpPlaybookStep } from '@vacp/core';
import { FastForward, PanelRightClose, PanelRightOpen, Play, RotateCcw, StepBack, StepForward } from 'lucide-react';
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

export function PlaybookModule(props: VacpDebugModuleProps): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rootSize = useElementSize(rootRef);
  const showSideBySide = rootSize.width >= 900;
  const compactControls = rootSize.width < 640;
  const dense = rootSize.width < 520 || rootSize.height < 360;
  const iconButtonSize = 'iconSm';
  const playbooks = props.playbooks ?? [];
  const [playbookId, setPlaybookId] = useState<string>(playbooks[0]?.id ?? '');
  const [stepIndex, setStepIndex] = useState<number>(0);
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<unknown>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const detailsOpen = useVacpDebugUiStore((s) => s.playbookDetailsOpen);
  const setDetailsOpen = useVacpDebugUiStore((s) => s.setPlaybookDetailsOpen);
  const effectiveDetailsOpen = detailsOpen && !dense;

  useEffect(() => {
    if (!dense || !detailsOpen) return;
    setDetailsOpen(false);
  }, [dense, detailsOpen, setDetailsOpen]);

  if (playbooks.length === 0) {
    return (
      <div
        ref={rootRef}
        className={cn(
          'h-full min-h-0',
          dense ? 'gap-2' : 'gap-3',
          effectiveDetailsOpen && showSideBySide ? 'grid grid-cols-[minmax(0,1fr)_minmax(320px,420px)]' : 'flex flex-col',
        )}
      >
        <Card className={cn('flex min-h-0 flex-1 flex-col', dense && 'p-2')}>
          <CardHeader>
            <div className="min-w-0">
              <CardTitle>Playbook</CardTitle>
              <CardDescription>No playbooks were provided for this view/spec.</CardDescription>
            </div>
          </CardHeader>
          <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3 text-[12px] leading-5 text-slate-100/80">
            This is expected for some examples. Try switching specs (in the host app) or use the other modules to explore the bridge.
          </div>
        </Card>
        {effectiveDetailsOpen ? (
          <Card className={cn('flex min-h-0 flex-col', !showSideBySide && 'max-h-[45%]', dense && 'p-2')}>
            <CardHeader>
              <div>
                <CardTitle>Step details</CardTitle>
                <CardDescription />
              </div>
            </CardHeader>
            <div className="min-h-0 flex-1 rounded-lg border border-white/10 bg-black/20 p-3 text-[12px] leading-5 text-slate-100/80">
              No steps to show.
            </div>
          </Card>
        ) : null}
      </div>
    );
  }

  const selected = useMemo(() => playbooks.find((p) => p.id === playbookId) ?? playbooks[0] ?? null, [playbooks, playbookId]);

  useEffect(() => {
    if (!selected) return;
    setPlaybookId(selected.id);
    setStepIndex(0);
    setLastResult(null);
    setLastError(null);
  }, [selected?.id]);

  const steps: VacpPlaybookStep[] = selected?.steps ?? [];
  const nextStep = steps[stepIndex] ?? null;

  const runStep = async (idx: number) => {
    const step = steps[idx];
    if (!step?.call) return;
    // Playbook steps are meant to demonstrate live bidirectional interaction.
    if (props.runtime.mode === 'inspect' && typeof props.bridge.setMode === 'function') {
      props.bridge.setMode('live', { source: 'debug', message: 'auto: back to live for playbook' });
    }
    setRunning(true);
    setLastError(null);
    setLastResult(null);
    const call: VacpActionCall = { ...step.call, callId: crypto.randomUUID() };
    try {
      const res = typeof props.bridge.dispatch === 'function' ? await props.bridge.dispatch(call, { source: 'agent' }) : await props.bridge.execute(call);
      setLastResult(res);
      if (!res.ok) setLastError(res.error?.message ?? 'Step failed');
    } catch (err) {
      setLastError(String(err));
      setLastResult(null);
    } finally {
      setRunning(false);
    }
  };

  const stepTo = (idx: number) => setStepIndex(Math.max(0, Math.min(idx, Math.max(0, steps.length - 1))));

  const runNext = async () => {
    if (!nextStep) return;
    if (nextStep.call) await runStep(stepIndex);
    stepTo(stepIndex + 1);
  };

  const runAll = async () => {
    for (let i = stepIndex; i < steps.length; i += 1) {
      const s = steps[i];
      if (s.call) await runStep(i);
      setStepIndex(i + 1);
    }
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        'h-full min-h-0',
        dense ? 'gap-2' : 'gap-3',
        effectiveDetailsOpen && showSideBySide ? 'grid grid-cols-[minmax(0,1fr)_minmax(320px,420px)]' : 'flex flex-col',
      )}
    >
      <Card className={cn('flex min-h-0 flex-1 flex-col', dense && 'p-2')}>
        <CardHeader className={cn(compactControls && 'flex-col items-stretch gap-2')}>
          <div className="min-w-0">
            <CardTitle>Playbook</CardTitle>
            <CardDescription>Step through a guided sequence that demonstrates bidirectional interaction.</CardDescription>
          </div>
          <div
            className={cn(
              'flex items-center gap-2',
              compactControls
                ? 'w-full flex-nowrap justify-start overflow-x-auto gap-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
                : 'shrink-0 flex-wrap justify-end',
            )}
          >
            <IconButton icon={<StepBack className="h-4 w-4 text-slate-100/90" />} size={iconButtonSize} label="Previous step" title="Move to the previous step." onClick={() => stepTo(stepIndex - 1)} />
            <IconButton icon={<StepForward className="h-4 w-4 text-slate-100/90" />} size={iconButtonSize} label="Next step" title="Move to the next step." onClick={() => stepTo(stepIndex + 1)} />
            <IconButton icon={<RotateCcw className="h-4 w-4 text-slate-100/90" />} size={iconButtonSize} label="Reset" title="Reset back to the first step." onClick={() => stepTo(0)} />
            <IconButton icon={<Play className="h-4 w-4 text-slate-100/90" />} size={iconButtonSize} label="Run step" title="Run the current step (if it has an action)." variant="primary" onClick={() => void runNext()} />
            <IconButton icon={<FastForward className="h-4 w-4 text-slate-100/90" />} size={iconButtonSize} label="Run all" title="Run the remaining steps." onClick={() => void runAll()} />
            <IconButton
              icon={detailsOpen ? <PanelRightClose className="h-4 w-4 text-slate-100/90" /> : <PanelRightOpen className="h-4 w-4 text-slate-100/90" />}
              size={iconButtonSize}
              label={detailsOpen ? 'Hide step details pane' : 'Show step details pane'}
              title={detailsOpen ? 'Hide Step details to give the step list more space.' : 'Show Step details.'}
              pressed={effectiveDetailsOpen}
              onClick={() => setDetailsOpen(!detailsOpen)}
            />
          </div>
        </CardHeader>

        <div className={cn(dense ? 'mt-2 grid gap-2' : 'mt-3 grid gap-3', !compactControls && 'grid-cols-[1fr_260px]')}>
          <div>
            <label className="text-[11px] font-medium text-slate-100/70" htmlFor="vacp-playbook">
              Playbook
            </label>
            <select
              id="vacp-playbook"
              className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-xs text-slate-100 outline-none focus:ring-2 focus:ring-sky-400/40"
              value={selected?.id ?? ''}
              onChange={(e) => setPlaybookId(e.target.value)}
            >
              {playbooks.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-slate-100/80">
            <div className="font-semibold text-slate-100/90">Current step</div>
            <div className="mt-1">
              {stepIndex + 1} / {Math.max(1, steps.length)} •{' '}
              <span className="font-medium text-slate-100/90">{nextStep?.title ?? '(done)'}</span>
            </div>
            {nextStep?.call ? <div className="mt-1 text-slate-100/70">This step will dispatch an action.</div> : <div className="mt-1 text-slate-100/70">This step is informational.</div>}
          </div>
        </div>

        {selected?.description ? <div className="mt-2 text-[11px] text-slate-100/80">{selected.description}</div> : null}

        <div className={cn(dense ? 'mt-2 min-h-0 flex-1 overflow-auto rounded-lg border border-white/10 bg-black/20' : 'mt-3 min-h-0 flex-1 overflow-auto rounded-lg border border-white/10 bg-black/20')}>
          <RovingFocusGroup orientation="vertical" loop asChild>
            <div className="p-1" role="listbox" aria-label="Playbook steps">
              {steps.map((s, i) => {
                const status = i < stepIndex ? 'done' : i === stepIndex ? 'next' : 'todo';
                const active = i === stepIndex;
                return (
                  <RovingFocusGroupItem key={`${s.id ?? ''}:${i}`} asChild>
                    <button
                      type="button"
                      className={cn(
                        'w-full rounded-lg border px-2 py-2 text-left text-xs transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60',
                        active ? 'border-sky-300/30 bg-sky-500/10' : 'border-transparent hover:border-white/10 hover:bg-white/5',
                      )}
                      data-vacp-row="playbook-step"
                      data-status={status}
                      aria-selected={active ? 'true' : 'false'}
                      onClick={() => stepTo(i)}
                    >
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-slate-100/90">
                          {i + 1}. {s.title}
                        </div>
                        <div className="flex-1" />
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-100/70">
                          {s.call ? 'action' : 'info'}
                        </span>
                      </div>
                      {s.description ? <div className="mt-1 text-[11px] text-slate-100/70">{s.description}</div> : null}
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
          <CardHeader className={cn(compactControls && 'flex-col items-stretch gap-2')}>
            <div>
              <CardTitle>Step details</CardTitle>
              <CardDescription>{running ? 'Running…' : lastError ? lastError : nextStep?.description ?? ''}</CardDescription>
            </div>
          </CardHeader>
          <div className="grid min-h-0 flex-1 gap-3">
            <div className="min-h-0">
              <div className="text-[11px] font-medium text-slate-100/70">Call</div>
              <JsonViewer value={nextStep?.call ?? null} className={cn('mt-1 min-h-0 max-h-[240px]', dense && 'p-2')} />
            </div>
            <div className="min-h-0">
              <div className="text-[11px] font-medium text-slate-100/70">Last result</div>
              <JsonViewer value={lastResult} className={cn('mt-1 min-h-0 flex-1', dense && 'p-2')} />
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
