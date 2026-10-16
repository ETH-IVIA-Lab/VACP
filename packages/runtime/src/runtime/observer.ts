import type { VacpProvenanceRecord, VacpObservation, VacpObservationCause, VacpExecution } from '@vacp/protocol';
import { stableStringify } from '@vacp/protocol';
import { makeEntryId, nowIso, systemActor } from './helpers';

/**
 * Records unattributed state changes against the last acknowledged state. Actions and refreshes
 * acknowledge what they recorded; provider invalidations record what changed since.
 */
export function createObservationRecorder<Live extends { inspection: VacpObservation }>(args: {
  ensureLive: () => Promise<Live>;
  record: (entry: VacpProvenanceRecord) => void;
}) {
  let lastState: string | undefined;
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

  const acknowledge = (observation: VacpObservation) => {
    lastObservation = observation.revision;
    lastState = stableStringify(observation.state);
  };

  return {
    readObserved,
    acknowledge,
    /** Take `observation` as the baseline unless one is already known. */
    prime(observation: VacpObservation) {
      if (lastState === undefined) acknowledge(observation);
    },
    /** Forget the baseline, so the next read establishes one without recording. */
    forget() {
      lastState = undefined;
      lastObservation = undefined;
    },
    reset() {
      lastState = undefined;
      lastObservation = undefined;
      effects.clear();
      reads.clear();
    },
    recordChange(observation: VacpObservation, cause: VacpObservationCause): void {
      if (observation.revision === lastObservation && lastState !== undefined) return;
      const previous = lastState;
      acknowledge(observation);
      if (previous === undefined || previous === lastState) return;
      args.record({
        id: makeEntryId(),
        at: nowIso(),
        kind: 'observation',
        cause,
        actor: systemActor(),
        message: 'Observed a change',
        observation,
      });
    },
    actionStarted(this: void, { id, restoration, operationKind }: VacpExecution) {
      if (operationKind === 'query') return;
      const effect = { executionId: id, restoration };
      effects.set(id, effect);
      for (const read of reads) read.set(id, effect);
    },
    actionFinished(this: void, id: string) {
      effects.delete(id);
    },
  };
}
