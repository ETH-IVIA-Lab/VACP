import type { VacpChangeSource, VacpHistoryEntry, VacpStateSnapshot } from '@vacp/protocol';

export function makeEntryId(): string {
  const id = globalThis.crypto?.randomUUID?.();

  if (id) return id;

  return `vacp_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export function notify(listeners: Set<(entry: VacpHistoryEntry) => void>, entry: VacpHistoryEntry): void {
  listeners.forEach((fn) => {
    try {
      fn(entry);
    } catch {
      // ignore observer failures
    }
  });
}

export function entrySource(source?: VacpChangeSource): VacpChangeSource {
  return source ?? 'system';
}

export function entryMessage(message?: string): string | undefined {
  return message && message.trim() ? message.trim() : undefined;
}

export function stateFromEntry(entry: VacpHistoryEntry): VacpStateSnapshot | undefined {
  return entry.state ?? entry.afterState ?? entry.beforeState;
}

export function liveStateFromEntry(entry: VacpHistoryEntry): VacpStateSnapshot | undefined {
  if (entry.kind === 'action') return entry.afterState;

  if (entry.kind === 'snapshot') return entry.state;

  return undefined;
}

export function findPrevIndexWithState(history: VacpHistoryEntry[], startIdx: number): number | null {
  for (let i = Math.min(startIdx, history.length - 1); i >= 0; i--) {
    if (stateFromEntry(history[i])) return i;
  }

  return null;
}

export function findLatestIndexWithLiveState(history: VacpHistoryEntry[]): number | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (liveStateFromEntry(history[i])) return i;
  }

  return null;
}

export function findNextIndexWithState(history: VacpHistoryEntry[], startIdx: number): number | null {
  for (let i = Math.max(0, startIdx); i < history.length; i++) {
    if (stateFromEntry(history[i])) return i;
  }

  return null;
}
