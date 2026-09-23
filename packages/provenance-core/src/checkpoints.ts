import {
  stableStringify,
  type VacpActor,
  type VacpFocus,
  type VacpObservation,
  type VacpProvenanceRecord,
} from '@vacp/protocol';

/** A captured view of a record. Metadata has one owner: the record itself. */
export type ProvenanceCheckpoint = {
  id: string;
  record: VacpProvenanceRecord;
  observation: VacpObservation;
  position: 'before' | 'after';
};

export function provenanceActor(record: VacpProvenanceRecord): VacpActor {
  return record.kind === 'action' ? record.execution.actor : record.actor;
}

export function provenanceFocus(record: VacpProvenanceRecord): VacpFocus | undefined {
  return record.kind === 'action'
    ? record.execution.intent?.focus
    : record.kind === 'observation'
      ? record.focus
      : undefined;
}

export function provenanceMessage(record: VacpProvenanceRecord): string {
  return record.message ?? (record.kind === 'action' ? record.execution.title : undefined) ?? 'Updated the analysis';
}

export function isRestorationRecord(record: VacpProvenanceRecord): boolean {
  return record.kind === 'action' && Boolean(record.execution.restoration);
}

const stateKeys = new WeakMap<object, string>();
/** Immutable captured state is serialized once however often checkpoints are projected. */
function stateKey(observation: VacpObservation): string {
  const { state } = observation;
  if (!Object.isFrozen(state)) return stableStringify(state);
  let key = stateKeys.get(state);
  if (key === undefined) stateKeys.set(state, (key = stableStringify(state)));
  return key;
}

/** State comparison deliberately excludes freshness and observation timestamps. */
export function sameAnalyticalState(a: VacpObservation, b: VacpObservation): boolean {
  return a.state === b.state || stateKey(a) === stateKey(b);
}

function checkpointObservations(record: VacpProvenanceRecord) {
  if (
    record.kind === 'session' ||
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
  // Failed operations can have applied effects; their captured outputs remain checkpoints.
  if (observations.after) append(observations.after, 'after');
}

/** Classify the complete chronology before a consumer filters actors or presentation. */
export function provenanceCheckpoints(records: readonly VacpProvenanceRecord[]): ProvenanceCheckpoint[] {
  const checkpoints: ProvenanceCheckpoint[] = [];
  for (const record of records) appendCheckpointRecord(checkpoints, record);
  return checkpoints;
}

/** A revision-fed mirror repairs only the retention boundary when its oldest record expires. */
export function createCheckpointProjection() {
  let records: VacpProvenanceRecord[] = [];
  let checkpoints: ProvenanceCheckpoint[] = [];
  let limit = 0;
  return {
    reset(snapshot: { records: readonly VacpProvenanceRecord[]; limit: number }) {
      let session = snapshot.records.length - 1;
      while (session >= 0 && snapshot.records[session]!.kind !== 'session') session--;
      records = snapshot.records.slice(Math.max(0, session));
      limit = snapshot.limit;
      checkpoints = provenanceCheckpoints(records);
    },
    append(record: VacpProvenanceRecord) {
      if (record.kind === 'session') records = [];
      records.push(record);
      appendCheckpointRecord(checkpoints, record);
      if (records.length <= limit) return;
      const evicted = records.shift()!;
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
    snapshot: () => Object.freeze(checkpoints.slice()),
    latest: () => checkpoints.at(-1) ?? null,
  };
}
