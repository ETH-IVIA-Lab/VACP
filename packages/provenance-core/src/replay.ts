import type {
  VacpExecution,
  VacpObservation,
  VacpProvenanceEvent,
  VacpProvenanceRecord,
  VacpProvenanceSnapshot,
  VacpTurnRecord,
} from '@vacp/protocol';
import {
  isRestorationRecord,
  createCheckpointProjection,
  sameAnalyticalState,
  type ProvenanceCheckpoint,
} from './checkpoints';
import type {
  ProvenanceReplayController,
  ProvenanceReplayOptions,
  ProvenanceReplaySource,
  ProvenanceReplayState,
} from './types';

/** Cancellation releases a viewer even if its host ignores the signal. */
function wait<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    void work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Viewer-owned navigation over runtime-owned recording, with explicit restoration authority. */
export function createProvenanceReplay(
  source: ProvenanceReplaySource,
  options: ProvenanceReplayOptions,
): ProvenanceReplayController {
  source.signal.throwIfAborted();
  const lifetime = new AbortController();
  const viewerId = globalThis.crypto.randomUUID();
  const listeners = new Set<() => void>();
  const running = new Set<string>();
  // A mirror of the retained journal, extended by events instead of re-reading the whole journal.
  let journal: VacpProvenanceSnapshot = source.getProvenance();
  const projection = createCheckpointProjection();
  projection.reset(journal);
  let epoch = journal.epoch;
  let steps: readonly ProvenanceCheckpoint[] = [];
  let turns: readonly VacpTurnRecord[] = [];
  let latest: ProvenanceCheckpoint | null = null;
  let baseline: VacpObservation | undefined;
  let currentObservation: VacpObservation | undefined;
  let selected = -1;
  let phase: ProvenanceReplayState['phase'] = 'live';
  let error: string | undefined;
  let request: AbortController | undefined;

  let view: ProvenanceReplayState | undefined;
  const synchronize = () => {
    journal = source.getProvenance();
    projection.reset(journal);
    epoch = journal.epoch;
  };
  const project = () => {
    latest = projection.latest();
    if (baseline || phase === 'restoring') return;
    steps = projection.snapshot();
    turns = projection.turns();
  };
  const publish = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* Presentation cannot change restoration. */
      }
    }
  };
  const resume = () => {
    request?.abort();
    request = undefined;
    baseline = undefined;
    currentObservation = undefined;
    selected = -1;
    phase = 'live';
    error = undefined;
    project();
    publish();
  };
  const externalChange = (record: VacpProvenanceRecord) => {
    if (isRestorationRecord(record) || record.kind === 'turn') return false;
    if (record.kind === 'session') return true;
    if (record.kind === 'action') return record.execution.operationKind !== 'query';
    if (record.cause.kind === 'concurrent')
      return !request || record.cause.executions.some((execution) => execution.restoration?.id !== viewerId);
    return !currentObservation || !sameAnalyticalState(currentObservation, record.observation);
  };
  const foreign = (execution: VacpExecution) =>
    !!execution.operationKind && execution.operationKind !== 'query' && execution.restoration?.id !== viewerId;
  const seedRunning = () => {
    running.clear();
    for (const execution of source.getActiveExecutions()) if (foreign(execution)) running.add(execution.id);
  };
  const onRecord = (event: VacpProvenanceEvent) => {
    if (event.epoch !== epoch || !event.record) {
      synchronize();
      running.clear();
      resume();
      return;
    }
    if (event.revision <= journal.revision) return;
    // A foreign step counts as live work until its record is in the trail, so stepping resumes with it.
    if (event.record.kind === 'action') running.delete(event.record.execution.id);
    if (event.revision === journal.revision + 1) {
      projection.append(event.record);
      journal = { ...journal, revision: event.revision };
    } else {
      synchronize();
      seedRunning();
    }
    if ((baseline || phase === 'restoring') && externalChange(event.record)) resume();
    else {
      project();
      publish();
    }
  };
  let detachRecords = () => {};
  let detachExecutions = () => {};
  const dispose = () => {
    if (lifetime.signal.aborted) return;
    lifetime.abort();
    request?.abort();
    detachRecords();
    detachExecutions();
    listeners.clear();
    source.signal.removeEventListener('abort', dispose);
  };
  try {
    project();
    detachRecords = source.subscribeProvenance(onRecord);
    detachExecutions = source.subscribeExecutions((execution) => {
      if (!foreign(execution)) return;
      // Live work outside this viewer ends review. Its record, not its outcome, ends the live work.
      if (execution.phase !== 'prepared' || running.has(execution.id)) return;
      running.add(execution.id);
      if (baseline || phase === 'restoring') return resume();
      if (running.size === 1) publish();
    });
    seedRunning();
    project();
    source.signal.addEventListener('abort', dispose, { once: true });
  } catch (cause) {
    dispose();
    throw cause;
  }

  const run = async (operation: (signal: AbortSignal) => Promise<void>) => {
    const current = new AbortController();
    request = current;
    const signal = AbortSignal.any([lifetime.signal, source.signal, current.signal]);
    phase = 'restoring';
    error = undefined;
    publish();
    try {
      await wait(
        Promise.resolve().then(() => {
          signal.throwIfAborted();
          return operation(signal);
        }),
        signal,
      );
    } catch (cause) {
      if (!signal.aborted) {
        phase = 'error';
        error = cause instanceof Error ? cause.message : String(cause);
        publish();
      }
    } finally {
      if (request === current) request = undefined;
    }
  };
  const restore = async (observation: VacpObservation, signal: AbortSignal, entryId?: string) => {
    currentObservation = observation;
    const result = await options.restore(structuredClone(observation), {
      signal,
      actor: { id: 'human', kind: 'human', label: 'You' },
      restoration: { id: viewerId, entryId },
    });
    signal.throwIfAborted();
    if (!result.ok) throw new Error(result.error.message);
  };
  const review = async (checkpointId: string) => {
    lifetime.signal.throwIfAborted();
    if (phase === 'restoring' || running.size) return;
    const index = steps.findIndex((step) => step.id === checkpointId);
    const checkpoint = steps[index];
    if (!checkpoint) throw new Error(`Unknown provenance checkpoint: ${checkpointId}`);
    // The requested checkpoint is selected before restoring publishes, so viewers mark the right frame.
    selected = index;
    await run(async (signal) => {
      if (!baseline) {
        const observation = await source.inspect();
        signal.throwIfAborted();
        baseline = observation;
      }
      await restore(checkpoint.observation, signal, checkpoint.record.id);
      phase = 'reviewing';
      publish();
    });
  };
  return {
    getState: () => {
      const current = selected < 0 ? null : (steps[selected] ?? null);
      const working = running.size > 0;
      if (
        view?.phase !== phase ||
        view.working !== working ||
        view.steps !== steps ||
        view.turns !== turns ||
        view.latest !== latest ||
        view.selected !== current ||
        view.error !== error
      )
        view = Object.freeze({ phase, steps, turns, latest, selected: current, working, error });
      return view;
    },
    subscribe(listener) {
      lifetime.signal.throwIfAborted();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    review,
    interrupt: () => {
      lifetime.signal.throwIfAborted();
      resume();
    },
    close: async () => {
      lifetime.signal.throwIfAborted();
      if (phase === 'restoring') return;
      if (!baseline) {
        resume();
        return;
      }
      const saved = baseline;
      selected = -1;
      await run(async (signal) => {
        await restore(saved, signal);
        resume();
      });
    },
    dispose,
  };
}
