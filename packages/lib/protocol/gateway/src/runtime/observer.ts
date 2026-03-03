import type { VacpCapabilitiesSnapshot, VacpChangeSource, VacpHistoryEntry, VacpStateSnapshot } from '@vacp/core';
import { nowIso, stableStringify } from '@vacp/core';

import { entryMessage, entrySource, makeEntryId } from './helpers';

export function createStateObserver(args: {
  getState: () => VacpStateSnapshot | Promise<VacpStateSnapshot>;
  getLive: () => { capabilities: VacpCapabilitiesSnapshot | null; state: VacpStateSnapshot | null };
  ensureLive: () => Promise<void>;
  record: (entry: VacpHistoryEntry) => void;
  shouldRecord?: () => boolean;
}) {
  const { getState, getLive, ensureLive, record } = args;
  const shouldRecord = args.shouldRecord ?? (() => true);

  let observeTimer: number | null = null;
  let lastObservedHash: string | null = null;
  let lastRecordedStateHash: string | null = null;
  let observeOptions: { intervalMs: number; source: VacpChangeSource; message?: string } = {
    intervalMs: 200,
    source: 'system',
    message: 'observed change',
  };

  const recordIfStateChanged = (source: VacpChangeSource, message: string) => {
    const { capabilities, state } = getLive();
    if (!state) return;
    try {
      const hash = stableStringify(state.state);
      if (lastRecordedStateHash === null) {
        lastRecordedStateHash = hash;
        return;
      }
      if (hash === lastRecordedStateHash) return;
      lastRecordedStateHash = hash;
      if (!shouldRecord()) return;
      record({
        id: makeEntryId(),
        at: nowIso(),
        kind: 'snapshot',
        source,
        message,
        capabilities: capabilities ?? undefined,
        state,
      });
    } catch {
      // ignore
    }
  };

  const observeOnce = async () => {
    try {
      const st = await Promise.resolve(getState());
      const hash = stableStringify(st.state);
      if (lastObservedHash === null) {
        lastObservedHash = hash;
        return;
      }
      if (hash === lastObservedHash) return;
      lastObservedHash = hash;
      if (!shouldRecord()) return;
      await ensureLive();
      const { capabilities, state } = getLive();
      record({
        id: makeEntryId(),
        at: nowIso(),
        kind: 'snapshot',
        source: observeOptions.source,
        message: observeOptions.message,
        capabilities: capabilities ?? undefined,
        state: state ?? undefined,
      });
    } catch {
      // Ignore observer failures; runtime must never break the host app.
    }
  };

  const startObserving = (options?: { intervalMs?: number; source?: VacpChangeSource; message?: string }) => {
    if (observeTimer !== null) return;
    observeOptions = {
      intervalMs: options?.intervalMs ?? 200,
      source: entrySource(options?.source),
      message: entryMessage(options?.message) ?? 'observed change',
    };
    lastObservedHash = null;
    void observeOnce();
    observeTimer = globalThis.setInterval(() => void observeOnce(), observeOptions.intervalMs) as unknown as number;
  };

  const stopObserving = () => {
    if (observeTimer === null) return;
    globalThis.clearInterval(observeTimer);
    observeTimer = null;
    lastObservedHash = null;
  };

  return { recordIfStateChanged, startObserving, stopObserving };
}
