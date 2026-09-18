import type { VacpLiveSnapshots } from './types.js';
import type { VacpChangeSource, VacpHistoryEntry, VacpObservation } from '@vacp/protocol';
import { nowIso } from '@vacp/protocol';
import { entryMessage, entrySource, makeEntryId } from './helpers.js';

export function createRuntimeObserver(args: {
  getLive: () => VacpObservation | null;
  ensureLive: () => Promise<VacpLiveSnapshots>;
  record: (entry: VacpHistoryEntry) => void;
  shouldRecord?: () => boolean;
}) {
  let timer: ReturnType<typeof globalThis.setInterval> | undefined;
  let reading = false;
  let lastRevision: string | undefined;

  const recordIfStateChanged = (source: VacpChangeSource, message: string): void => {
    const observation = args.getLive();
    if (!observation) return;
    const previous = lastRevision;
    lastRevision = observation.revision;
    if (previous === undefined || previous === lastRevision || args.shouldRecord?.() === false) return;
    args.record({
      id: makeEntryId(),
      at: nowIso(),
      kind: 'snapshot',
      source,
      message,
      observation,
      capabilities: { version: observation.version, createdAt: observation.observedAt, graph: observation.graph },
      state: {
        version: observation.version,
        createdAt: observation.observedAt,
        state: observation.state,
        summary: observation.summary,
      },
    });
  };

  const startObserving = (options?: { intervalMs?: number; source?: VacpChangeSource; message?: string }): void => {
    if (timer !== undefined) return;
    const source = entrySource(options?.source);
    const message = entryMessage(options?.message) ?? 'observed change';
    const observe = async () => {
      if (reading) return;
      reading = true;
      try {
        await args.ensureLive();
        recordIfStateChanged(source, message);
      } catch {
        // Polling is best effort; explicit reads report provider failures.
      } finally {
        reading = false;
      }
    };
    void observe();
    timer = globalThis.setInterval(() => void observe(), options?.intervalMs ?? 200);
  };

  const stopObserving = (): void => {
    globalThis.clearInterval(timer);
    timer = undefined;
    lastRevision = undefined;
  };
  return { recordIfStateChanged, startObserving, stopObserving };
}
