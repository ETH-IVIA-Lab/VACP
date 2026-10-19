import { isVacpExecutionSettled, type VacpExecution, type VacpExecutionGate } from '@ethivia/vacp-protocol';
import { notify, nowIso } from './helpers';

/** Optional presentation work never owns action success or cancellation. */
export function createExecutionChannel(lifetime: AbortSignal) {
  const listeners = new Set<(execution: VacpExecution) => void>();
  const gates = new Map<
    VacpExecutionGate,
    { timeoutMs: number; lifetime: AbortController; stage: 'before' | 'after' }
  >();
  const pending = new Map<string, VacpExecution>();
  let closed = false;
  let latestSequence = 0;
  let retiredThrough = 0;
  const reset = (message: string) => {
    retiredThrough = latestSequence;
    const cancelled = [...pending.values()].map((execution): VacpExecution => ({
      ...execution,
      phase: 'cancelled',
      at: nowIso(),
      message,
    }));
    pending.clear();
    return () => {
      for (const execution of cancelled) notify(listeners, execution);
    };
  };

  const waitForGate = (gate: VacpExecutionGate, timeoutMs: number, execution: VacpExecution, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      const controller = new AbortController();
      const gateSignal = AbortSignal.any([signal, controller.signal]);
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', finish);
        controller.abort();
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      signal.addEventListener('abort', finish, { once: true });
      if (signal.aborted) finish();
      else
        Promise.resolve()
          .then(() => {
            if (!gateSignal.aborted) return gate(structuredClone(execution), gateSignal);
          })
          .then(finish, finish);
    });

  lifetime.addEventListener(
    'abort',
    () => {
      closed = true;
      reset('Runtime disposed')();
      for (const gate of gates.values()) gate.lifetime.abort();
      listeners.clear();
      gates.clear();
    },
    { once: true },
  );

  return {
    reset,
    emit: (execution: VacpExecution) => {
      if (closed || execution.sequence <= retiredThrough) return;
      latestSequence = Math.max(latestSequence, execution.sequence);
      if (isVacpExecutionSettled(execution)) pending.delete(execution.id);
      else pending.set(execution.id, { ...execution });
      notify(listeners, execution);
    },
    getActiveExecutions: () => structuredClone([...pending.values()]),
    subscribeExecutions(this: void, listener: (execution: VacpExecution) => void) {
      lifetime.throwIfAborted();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    addExecutionGate(this: void, gate: VacpExecutionGate, options: { timeoutMs: number; stage?: 'before' | 'after' }) {
      lifetime.throwIfAborted();
      if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0)
        throw new Error('Gate timeout must be finite and non-negative');
      if (gates.has(gate)) throw new Error('Execution gate is already installed');
      const gateLifetime = new AbortController();
      gates.set(gate, { timeoutMs: options.timeoutMs, lifetime: gateLifetime, stage: options.stage ?? 'before' });
      return () => {
        gates.delete(gate);
        gateLifetime.abort();
      };
    },
    present(
      execution: VacpExecution,
      signal: AbortSignal,
      stage: 'before' | 'after' = 'before',
    ): Promise<void> | undefined {
      if (stage === 'before') signal.throwIfAborted();
      const selected = [...gates].filter(([, binding]) => binding.stage === stage);
      if (!selected.length || signal.aborted) return;
      return Promise.all(
        selected.map(([gate, binding]) =>
          waitForGate(gate, binding.timeoutMs, execution, AbortSignal.any([signal, binding.lifetime.signal])),
        ),
      ).then(() => {
        if (stage === 'before') signal.throwIfAborted();
      });
    },
  };
}
