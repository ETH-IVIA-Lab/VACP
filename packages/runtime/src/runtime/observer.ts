import type {
  VacpActor,
  VacpProvenanceRecord,
  VacpObservation,
  VacpObservationCause,
  VacpExecution,
} from '@vacp/protocol';
import { nowIso, stableStringify } from '@vacp/protocol';
import { entryMessage, entryActor, makeEntryId } from './helpers';

export function createRuntimeObserver<Live extends { inspection: VacpObservation }>(args: {
  ensureLive: () => Promise<Live>;
  record: (entry: VacpProvenanceRecord) => void;
}) {
  let timer: ReturnType<typeof globalThis.setInterval> | undefined;
  let reading: number | undefined;
  let generation = 0;
  let lastRevision: string | undefined;
  // Observation revisions witness graph, state and freshness; an unchanged one cannot change state.
  let lastObservation: string | undefined;

  type Effect = { executionId: string; restoration?: VacpExecution['restoration'] };
  const effects = new Map<string, Effect>();
  const reads = new Set<Map<string, Effect>>();
  const readObserved = async (): Promise<Live & { cause: VacpObservationCause }> => {
    const overlapping = new Map(effects);
    reads.add(overlapping);
    try {
      const live = await args.ensureLive();
      const cause: VacpObservationCause = overlapping.size
        ? { kind: 'concurrent', executions: [...overlapping.values()] }
        : { kind: 'external' };
      return { ...live, cause };
    } finally {
      reads.delete(overlapping);
    }
  };

  const recordIfStateChanged = (
    observation: VacpObservation,
    actor: VacpActor,
    message: string,
    cause: VacpObservationCause,
  ): void => {
    if (observation.revision === lastObservation && lastRevision !== undefined) return;
    lastObservation = observation.revision;
    const previous = lastRevision;
    lastRevision = stableStringify(observation.state);
    if (previous === undefined || previous === lastRevision) return;
    args.record({
      id: makeEntryId(),
      at: nowIso(),
      kind: 'observation',
      cause,
      actor,
      message,
      observation,
    });
  };

  const startObserving = (options?: { intervalMs?: number; actor?: VacpActor; message?: string }): void => {
    if (timer !== undefined) return;
    const actor = entryActor(options?.actor);
    const message = entryMessage(options?.message) ?? 'observed change';
    const observe = async () => {
      if (reading === generation) return;
      const started = generation;
      reading = started;
      try {
        const { inspection, cause } = await readObserved();
        if (started === generation) recordIfStateChanged(inspection, actor, message, cause);
      } catch {
        // Polling is best effort; explicit reads report provider failures.
      } finally {
        if (reading === started) reading = undefined;
      }
    };
    void observe();
    timer = globalThis.setInterval(() => void observe(), options?.intervalMs ?? 200);
  };

  const stopObserving = (): void => {
    globalThis.clearInterval(timer);
    timer = undefined;
    generation++;
    lastRevision = undefined;
    lastObservation = undefined;
  };
  return {
    readObserved,
    reset() {
      stopObserving();
      effects.clear();
      reads.clear();
    },
    actionStarted({ id, restoration, operationKind }: VacpExecution) {
      if (operationKind === 'query') return;
      const effect = { executionId: id, restoration };
      effects.set(id, effect);
      for (const read of reads) read.set(id, effect);
    },
    actionFinished(id: string) {
      effects.delete(id);
    },
    recordIfStateChanged,
    acknowledge: (observation: VacpObservation) => {
      lastObservation = observation.revision;
      lastRevision = stableStringify(observation.state);
    },
    startObserving,
    stopObserving,
  };
}
