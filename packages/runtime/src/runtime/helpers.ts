import { captureVacpValue, type VacpActor } from '@vacp/protocol';

export function makeEntryId(): string {
  const id = globalThis.crypto?.randomUUID?.();

  if (id) return id;

  return `vacp_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function systemActor(): VacpActor {
  return { id: 'system', kind: 'system' };
}

/**
 * Deliver an event, captured once. Ordinary records and arrays reach every listener as one frozen
 * value; exotic host values, such as a Date, are copied for each listener.
 */
export function notify<Value>(listeners: Set<(entry: Value) => void>, entry: Value): void {
  if (!listeners.size) return;
  const read = captureVacpValue(entry);
  listeners.forEach((fn) => {
    try {
      fn(read());
    } catch {
      // ignore observer failures
    }
  });
}

export function entryActor(actor?: VacpActor): VacpActor {
  return actor ? structuredClone(actor) : systemActor();
}

export function entryMessage(message?: string): string | undefined {
  return message && message.trim() ? message.trim() : undefined;
}
