import type { VacpExecutionControl } from '@vacp/protocol';
import type { PresencePacing, PresenceArrival } from './types.js';

/** Abort releases presentation time, never the application's execution signal. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  if (ms === 0 || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

async function approach(run: (signal: AbortSignal) => Promise<void>, ms: number, signal: AbortSignal) {
  if (ms === 0 || signal.aborted) return;
  const lifetime = new AbortController();
  const bounded = AbortSignal.any([lifetime.signal, signal]);
  try {
    await Promise.race([
      Promise.resolve().then(() => {
        if (!bounded.aborted) return run(bounded);
      }),
      pause(ms, bounded),
    ]);
  } finally {
    lifetime.abort();
  }
}

function presenceTiming(options: PresencePacing) {
  const timing = {
    arrivalTimeoutMs: options.arrivalTimeoutMs ?? 350,
    beforeExecuteMs: options.beforeExecuteMs ?? 0,
    afterExecuteMs: options.afterExecuteMs ?? 0,
  };
  for (const [name, value] of Object.entries(timing)) {
    if (!Number.isFinite(value) || value < 0 || value > 60_000)
      throw new Error(`${name} must be between 0 and 60000 ms`);
  }
  return timing;
}

/** The host explicitly grants timing authority to one viewer. Disposal releases waits. */
export function paceAgentPresence(
  control: VacpExecutionControl,
  presence: PresenceArrival,
  options: PresencePacing = {},
): () => void {
  control.signal.throwIfAborted();
  presence.signal.throwIfAborted();
  const timing = presenceTiming(options);
  const includes = (id: string) => presence.getSnapshot().some(({ execution }) => execution.id === id);
  const removeBefore = control.addExecutionGate(
    async (execution, signal) => {
      if (!includes(execution.id)) return;
      await approach((next) => presence.arrive(execution.id, next), timing.arrivalTimeoutMs, signal);
      await pause(timing.beforeExecuteMs, signal);
    },
    { timeoutMs: timing.arrivalTimeoutMs + timing.beforeExecuteMs },
  );
  let removeAfter: (() => void) | undefined;
  try {
    if (timing.afterExecuteMs)
      removeAfter = control.addExecutionGate(
        async (execution, signal) => {
          if (includes(execution.id)) await pause(timing.afterExecuteMs, signal);
        },
        { timeoutMs: timing.afterExecuteMs, stage: 'after' },
      );
  } catch (error) {
    removeBefore();
    throw error;
  }
  const dispose = () => {
    removeBefore();
    removeAfter?.();
    control.signal.removeEventListener('abort', dispose);
    presence.signal.removeEventListener('abort', dispose);
  };
  control.signal.addEventListener('abort', dispose, { once: true });
  presence.signal.addEventListener('abort', dispose, { once: true });
  if (control.signal.aborted || presence.signal.aborted) dispose();
  return dispose;
}
