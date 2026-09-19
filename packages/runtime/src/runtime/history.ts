import type { VacpHistoryEntry } from '@vacp/protocol';

/** Recording owns copies. Reading or selecting them never affects a live source. */
export function createRuntimeHistory() {
  const entries: VacpHistoryEntry[] = [];
  return {
    record(entry: VacpHistoryEntry) {
      const captured = structuredClone(entry);
      entries.push(captured);
      return captured;
    },
    snapshot: () => structuredClone(entries),
    clear: () => {
      entries.length = 0;
    },
  };
}
