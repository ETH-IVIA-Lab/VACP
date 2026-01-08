import type { VacpActionCall, VacpPlaybookStep } from '@vacp/core';
import { FastForward, Play, RotateCcw, StepBack, StepForward } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { IconButton } from '@vacp/debug-ui/overlay/icon-button';
import { Card, CardDescription, CardHeader, CardTitle } from '@vacp/debug-ui/ui/components/ui/card';

import type { VacpDebugModuleProps } from './module-types';

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function PlaybookModule(props: VacpDebugModuleProps): ReactElement {
  const playbooks = props.playbooks ?? [];
  const [playbookId, setPlaybookId] = useState<string>(playbooks[0]?.id ?? '');
  const [stepIndex, setStepIndex] = useState<number>(0);
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<unknown>(null);
  const [lastError, setLastError] = useState<string | null>(null);

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
    <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[1fr_420px]">
      <Card className="flex min-h-0 flex-col">
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>Playbook</CardTitle>
            <CardDescription>Step through a guided sequence that demonstrates bidirectional interaction.</CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <IconButton icon={<StepBack className="h-4 w-4 text-slate-100/90" />} label="Previous step" title="Move to the previous step." onClick={() => stepTo(stepIndex - 1)} />
            <IconButton icon={<StepForward className="h-4 w-4 text-slate-100/90" />} label="Next step" title="Move to the next step." onClick={() => stepTo(stepIndex + 1)} />
            <IconButton icon={<RotateCcw className="h-4 w-4 text-slate-100/90" />} label="Reset" title="Reset back to the first step." onClick={() => stepTo(0)} />
            <IconButton icon={<Play className="h-4 w-4 text-slate-100/90" />} label="Run step" title="Run the current step (if it has an action)." variant="primary" onClick={() => void runNext()} />
            <IconButton icon={<FastForward className="h-4 w-4 text-slate-100/90" />} label="Run all" title="Run the remaining steps." onClick={() => void runAll()} />
          </div>
        </CardHeader>

        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_260px]">
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

        <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-lg border border-white/10 bg-black/20">
          <div className="p-1">
            {steps.map((s, i) => {
              const status = i < stepIndex ? 'done' : i === stepIndex ? 'next' : 'todo';
              const active = i === stepIndex;
              return (
                <button
                  key={`${s.id ?? ''}:${i}`}
                  type="button"
                  className={[
                    'w-full rounded-lg border px-2 py-2 text-left text-xs transition-colors',
                    active ? 'border-sky-300/30 bg-sky-500/10' : 'border-transparent hover:border-white/10 hover:bg-white/5',
                  ].join(' ')}
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
              );
            })}
          </div>
        </div>
      </Card>

      <Card className="flex min-h-0 flex-col">
        <CardHeader>
          <div>
            <CardTitle>Step details</CardTitle>
            <CardDescription>{running ? 'Running…' : lastError ? lastError : nextStep?.description ?? ''}</CardDescription>
          </div>
        </CardHeader>
        <div className="grid min-h-0 flex-1 gap-3">
          <div className="min-h-0">
            <div className="text-[11px] font-medium text-slate-100/70">Call</div>
            <pre className="mt-1 min-h-0 max-h-[240px] overflow-auto rounded-lg border border-white/10 bg-black/20 p-3 text-[12px] leading-5 text-slate-100/85">
              {nextStep?.call ? safeJson(nextStep.call) : ''}
            </pre>
          </div>
          <div className="min-h-0">
            <div className="text-[11px] font-medium text-slate-100/70">Last result</div>
            <pre className="mt-1 min-h-0 flex-1 overflow-auto rounded-lg border border-white/10 bg-black/20 p-3 text-[12px] leading-5 text-slate-100/85">
              {safeJson(lastResult)}
            </pre>
          </div>
        </div>
      </Card>
    </div>
  );
}
