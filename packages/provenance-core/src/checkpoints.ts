import {
  sameVacpValue,
  type VacpObservation,
  type VacpProvenanceRecord,
  type VacpTurnRecord,
} from '@ethivia/vacp-protocol';

/** A captured view of a record. Metadata has one owner: the record itself. */
export type ProvenanceCheckpoint = {
  id: string;
  record: VacpProvenanceRecord;
  observation: VacpObservation;
  position: 'before' | 'after';
};

export function isRestorationRecord(record: VacpProvenanceRecord): boolean {
  return record.kind === 'action' && Boolean(record.execution.restoration);
}

/** State comparison deliberately excludes freshness and observation timestamps. */
export function sameAnalyticalState(a: VacpObservation, b: VacpObservation): boolean {
  return sameVacpValue(a.state, b.state);
}

function checkpointObservations(record: VacpProvenanceRecord) {
  if (
    record.kind === 'session' ||
    record.kind === 'turn' ||
    isRestorationRecord(record) ||
    (record.kind === 'observation' && record.cause.kind === 'concurrent')
  )
    return undefined;
  if (record.kind === 'action') {
    if (!record.before || !record.execution.operationKind || record.execution.operationKind === 'query')
      return undefined;
    return { before: record.before, after: record.observation };
  }
  return { before: undefined, after: record.observation };
}

function appendCheckpointRecord(checkpoints: ProvenanceCheckpoint[], record: VacpProvenanceRecord): void {
  if (record.kind === 'session') {
    checkpoints.length = 0;
    return;
  }
  const observations = checkpointObservations(record);
  if (!observations) return;
  const append = (observation: VacpObservation, position: 'before' | 'after') => {
    const previous = checkpoints.at(-1)?.observation;
    if (previous && sameAnalyticalState(previous, observation)) return;
    checkpoints.push(
      Object.freeze({ id: position === 'before' ? `${record.id}:before` : record.id, record, observation, position }),
    );
  };
  if (!checkpoints.length && observations.before) append(observations.before, 'before');
  // Failed operations can have applied effects. Their captured outputs remain checkpoints.
  if (observations.after) append(observations.after, 'after');
}

/** Classify the complete chronology before a consumer filters actors or presentation. */
export function provenanceCheckpoints(records: readonly VacpProvenanceRecord[]): ProvenanceCheckpoint[] {
  const checkpoints: ProvenanceCheckpoint[] = [];
  for (const record of records) appendCheckpointRecord(checkpoints, record);
  return checkpoints;
}

export type CheckpointProjection = {
  reset(snapshot: { records: readonly VacpProvenanceRecord[]; limit: number }): void;
  append(record: VacpProvenanceRecord): void;
  snapshot(): readonly ProvenanceCheckpoint[];
  turns(): readonly VacpTurnRecord[];
  latest(): ProvenanceCheckpoint | null;
};

/**
 * A revision-fed mirror repairs only the retention boundary when its oldest record expires. Its
 * `snapshot()` and `turns()` keep their identity until a record changes them.
 */
export function createCheckpointProjection(): CheckpointProjection {
  let records: VacpProvenanceRecord[] = [];
  let checkpoints: ProvenanceCheckpoint[] = [];
  let turns: VacpTurnRecord[] = [];
  let limit = 0;
  let steps: readonly ProvenanceCheckpoint[] | undefined;
  let finished: readonly VacpTurnRecord[] | undefined;
  return {
    reset(snapshot: { records: readonly VacpProvenanceRecord[]; limit: number }) {
      let session = snapshot.records.length - 1;
      while (session >= 0 && snapshot.records[session]!.kind !== 'session') session--;
      records = snapshot.records.slice(Math.max(0, session));
      limit = snapshot.limit;
      checkpoints = provenanceCheckpoints(records);
      turns = records.filter((record): record is VacpTurnRecord => record.kind === 'turn');
      steps = finished = undefined;
    },
    append(record: VacpProvenanceRecord) {
      if (record.kind === 'session') {
        records = [];
        turns = [];
        finished = undefined;
      }
      records.push(record);
      const counted = checkpoints.length;
      const last = checkpoints.at(-1);
      appendCheckpointRecord(checkpoints, record);
      if (checkpoints.length !== counted || checkpoints.at(-1) !== last) steps = undefined;
      if (record.kind === 'turn') {
        turns.push(record);
        finished = undefined;
      }
      if (records.length <= limit) return;
      const evicted = records.shift()!;
      if (evicted.kind === 'turn') {
        turns.shift();
        finished = undefined;
      }
      steps = undefined;
      const anchor = records.findIndex((entry) => checkpointObservations(entry)?.after !== undefined);
      if (anchor < 0) {
        checkpoints = provenanceCheckpoints(records);
        return;
      }
      // The first remaining observed output fixes the input state for every following checkpoint.
      // Only its prefix can change when the previous baseline disappears.
      const prefix = records.slice(0, anchor + 1);
      const replaced = new Set([evicted, ...prefix]);
      checkpoints = [
        ...provenanceCheckpoints(prefix),
        ...checkpoints.filter((checkpoint) => !replaced.has(checkpoint.record)),
      ];
    },
    snapshot: () => (steps ??= Object.freeze(checkpoints.slice())),
    turns: () => (finished ??= Object.freeze(turns.slice())),
    latest: () => checkpoints.at(-1) ?? null,
  };
}
