import type { VacpActor } from '@vacp/protocol';

export function makeEntryId(): string {
  const id = globalThis.crypto?.randomUUID?.();

  if (id) return id;

  return `vacp_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export function notify<Value>(listeners: Set<(entry: Value) => void>, entry: Value): void {
  listeners.forEach((fn) => {
    try {
      fn(structuredClone(entry));
    } catch {
      // ignore observer failures
    }
  });
}

export function entryActor(actor?: VacpActor): VacpActor {
  return actor ? structuredClone(actor) : { id: 'system', kind: 'system' };
}

export function entryMessage(message?: string): string | undefined {
  return message && message.trim() ? message.trim() : undefined;
}
