import { abortable, vacpHumanActor } from '@vacp/protocol';
import type {
  VacpExecution,
  VacpObservation,
  VacpProvenanceEvent,
  VacpProvenanceRecord,
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
  const projection = createCheckpointProjection();
  let epoch = 0;
  let revision = 0;
  let steps: readonly ProvenanceCheckpoint[] = [];
  let turns: readonly VacpTurnRecord[] = [];
  let latest: ProvenanceCheckpoint | null = null;
  let baseline: VacpObservation | undefined;
  let currentObservation: VacpObservation | undefined;
  let selected = -1;
  let status: { phase: 'error'; error: string } | { phase: 'live' | 'restoring' | 'reviewing' } = { phase: 'live' };
  let request: AbortController | undefined;

  let view: ProvenanceReplayState | undefined;
  const synchronize = () => {
    const journal = source.getProvenance();
    projection.reset(journal);
    epoch = journal.epoch;
    revision = journal.revision;
  };
  const project = () => {
    latest = projection.latest();
    if (baseline || status.phase === 'restoring') return;
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
    status = { phase: 'live' };
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
    if (event.revision <= revision) return;
    // A foreign step counts as live work until its record is in the trail, so stepping resumes with it.
    if (event.record.kind === 'action') running.delete(event.record.execution.id);
    if (event.revision === revision + 1) {
      projection.append(event.record);
      revision = event.revision;
    } else {
      synchronize();
      seedRunning();
    }
    if ((baseline || status.phase === 'restoring') && externalChange(event.record)) resume();
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
    synchronize();
    project();
    detachRecords = source.subscribeProvenance(onRecord);
    detachExecutions = source.subscribeExecutions((execution) => {
      if (!foreign(execution)) return;
      // Live work outside this viewer ends review. Its record, not its outcome, ends the live work.
      if (execution.phase !== 'prepared' || running.has(execution.id)) return;
      running.add(execution.id);
      if (baseline || status.phase === 'restoring') return resume();
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
    status = { phase: 'restoring' };
    publish();
    try {
      await abortable(signal, () => operation(signal));
    } catch (cause) {
      if (!signal.aborted) {
        status = { phase: 'error', error: cause instanceof Error ? cause.message : String(cause) };
        publish();
      }
    } finally {
      if (request === current) request = undefined;
    }
  };
  const restore = async (observation: VacpObservation, signal: AbortSignal, entryId?: string) => {
    currentObservation = observation;
    const result = await options.restore(observation.state, {
      signal,
      actor: vacpHumanActor,
      restoration: { id: viewerId, entryId },
    });
    signal.throwIfAborted();
    if (!result.ok) throw new Error(result.error.message);
  };
  const review = async (checkpointId: string) => {
    lifetime.signal.throwIfAborted();
    if (status.phase === 'restoring' || running.size) return;
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
      status = { phase: 'reviewing' };
      publish();
    });
  };
  return {
    getState: () => {
      const current = selected < 0 ? null : (steps[selected] ?? null);
      const working = running.size > 0;
      if (
        view?.phase !== status.phase ||
        view.working !== working ||
        view.steps !== steps ||
        view.turns !== turns ||
        view.latest !== latest ||
        view.selected !== current ||
        (view.phase === 'error' ? view.error : undefined) !== (status.phase === 'error' ? status.error : undefined)
      )
        view = Object.freeze({ steps, turns, latest, selected: current, working, ...status });
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
      if (status.phase === 'restoring') return;
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
