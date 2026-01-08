import type { VacpActionCall, VacpPlaybook, VacpPlaybookStep } from '@vacp/core';
import { FastForward, Play, RotateCcw, StepBack, StepForward } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { IconButton } from '../icon-button';

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
      setStepIndex((cur) => Math.max(cur, i + 1));
    }
  };

  return (
    <div className="vacp-debug-ui-page">
      <section className="vacp-debug-ui-card">
        <div className="vacp-debug-ui-card-header">
          <div>
            <div className="vacp-debug-ui-card-title">Playbook</div>
            <div className="vacp-debug-ui-card-subtitle">A guided sequence to demonstrate bidirectional interaction.</div>
          </div>
          <div className="vacp-debug-ui-toolbar">
            <IconButton
              icon={<StepBack className="vacp-debug-ui-icon" size={16} />}
              label="Previous step"
              title="Move to the previous step."
              onClick={() => stepTo(stepIndex - 1)}
            />
            <IconButton
              icon={<StepForward className="vacp-debug-ui-icon" size={16} />}
              label="Next step"
              title="Move to the next step."
              onClick={() => stepTo(stepIndex + 1)}
            />
            <IconButton
              icon={<RotateCcw className="vacp-debug-ui-icon" size={16} />}
              label="Reset"
              title="Reset back to the first step."
              onClick={() => stepTo(0)}
            />
            <IconButton
              icon={<Play className="vacp-debug-ui-icon" size={16} />}
              label="Run step"
              title="Run the current step (if it has an action)."
              variant="primary"
              onClick={() => void runNext()}
            />
            <IconButton
              icon={<FastForward className="vacp-debug-ui-icon" size={16} />}
              label="Run all"
              title="Run the remaining steps."
              onClick={() => void runAll()}
            />
          </div>
        </div>

        <div className="vacp-debug-ui-field" style={{ marginTop: 10 }}>
          <label htmlFor="vacp-playbook">Playbook</label>
          <select id="vacp-playbook" value={selected?.id ?? ''} onChange={(e) => setPlaybookId(e.target.value)}>
            {playbooks.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>

        {selected?.description ? <div className="vacp-debug-ui-small">{selected.description}</div> : null}
        <div className="vacp-debug-ui-small" style={{ marginTop: 10, opacity: 0.85 }}>
          Next: <strong>{nextStep?.title ?? '(done)'}</strong>
        </div>

        <div className="vacp-debug-ui-list" style={{ marginTop: 12 }}>
          {steps.map((s, i) => {
            const status = i < stepIndex ? 'done' : i === stepIndex ? 'next' : 'todo';
            return (
              <div
                key={`${s.id ?? ''}:${i}`}
                className="vacp-debug-ui-row"
                data-vacp-row="playbook-step"
                data-status={status}
                aria-selected={i === stepIndex ? 'true' : 'false'}
                onClick={() => stepTo(i)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontWeight: 650 }}>
                    {i + 1}. {s.title}
                  </div>
                  <div style={{ flex: '1 1 auto' }} />
                  {s.call ? (
                    <span className="vacp-debug-ui-small" style={{ opacity: 0.85 }}>
                      action
                    </span>
                  ) : (
                    <span className="vacp-debug-ui-small" style={{ opacity: 0.7 }}>
                      info
                    </span>
                  )}
                </div>
                {s.description ? <div className="vacp-debug-ui-small">{s.description}</div> : null}
                {i === stepIndex && s.call ? (
                  <details className="vacp-debug-ui-details">
                    <summary>Call</summary>
                    <pre className="vacp-debug-ui-code" style={{ whiteSpace: 'pre-wrap' }}>
                      {safeJson(s.call)}
                    </pre>
                  </details>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <section className="vacp-debug-ui-card">
        <div className="vacp-debug-ui-card-header">
          <div>
            <div className="vacp-debug-ui-card-title">Last result</div>
            <div className="vacp-debug-ui-card-subtitle">{running ? 'Running…' : lastError ? lastError : ''}</div>
          </div>
        </div>
        <pre className="vacp-debug-ui-code" style={{ whiteSpace: 'pre-wrap' }}>
          {safeJson(lastResult)}
        </pre>
      </section>
    </div>
  );
}
