import type { VacpProvenanceEvent, VacpProvenanceRecord, VacpProvenanceSnapshot } from '@vacp/protocol';

import { captureVacpValue } from '@vacp/protocol';

function captureRecord(record: VacpProvenanceRecord): () => VacpProvenanceRecord {
  try {
    return captureVacpValue(record);
  } catch (error) {
    if (record.kind !== 'action') throw error;
    // Metadata was validated before effects; result payload capture cannot change a known outcome.
    const result = record.result.ok
      ? { callId: record.result.callId, ok: true as const }
      : { callId: record.result.callId, ok: false as const, error: { message: record.result.error.message } };
    return captureVacpValue({
      ...record,
      result,
      captureErrors: [
        ...(record.captureErrors ?? []),
        { field: 'result', message: 'Result payload is not structured-cloneable' },
      ],
    });
  }
}

/** One bounded journal owns recording identity, retention, and observer isolation. */
export function createProvenanceJournal(options: { runtimeId: string; sessionKey?: string; limit?: number }) {
  const limit = options.limit ?? 256;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('historyLimit must be a positive integer');
  const records: Array<() => VacpProvenanceRecord> = [];
  const listeners = new Set<(event: VacpProvenanceEvent) => void>();
  let sessionKey = options.sessionKey;
  let epoch = 0;
  let revision = 0;
  const notify = (readRecord: (() => VacpProvenanceRecord) | null) => {
    const currentEpoch = epoch;
    const currentRevision = revision;
    for (const listener of listeners) {
      try {
        listener(Object.freeze({ epoch: currentEpoch, revision: currentRevision, record: readRecord?.() ?? null }));
      } catch {
        // Observer failures cannot affect recording.
      }
    }
  };
  return {
    get epoch() {
      return epoch;
    },
    get subscribed() {
      return listeners.size > 0;
    },
    getProvenance(): VacpProvenanceSnapshot {
      return Object.freeze({
        runtimeId: options.runtimeId,
        sessionKey,
        epoch,
        revision,
        limit,
        records: Object.freeze(records.map((read) => read())),
      });
    },
    subscribeProvenance(listener: (event: VacpProvenanceEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    record(record: VacpProvenanceRecord) {
      const captured = captureRecord(record);
      records.push(captured);
      if (records.length > limit) records.shift();
      revision++;
      notify(captured);
    },
    reset(nextSessionKey?: string) {
      sessionKey = nextSessionKey;
      records.length = 0;
      revision = 0;
      epoch++;
      notify(null);
    },
    dispose() {
      listeners.clear();
      records.length = 0;
    },
  };
}
