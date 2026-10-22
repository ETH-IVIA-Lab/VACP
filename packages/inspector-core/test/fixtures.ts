import type { InspectorClient, InspectorSession, InspectorState } from '../src/index';
import { VACP_SCHEMA_VERSION, type VacpObservation } from '@ethivia/vacp-protocol';

export function observation(value = 0): VacpObservation {
  return {
    version: VACP_SCHEMA_VERSION,
    revision: String(value),
    observedAt: '2026-09-18T12:00:00Z',
    graph: {
      sources: [{ id: 'vacp-source://test', type: 'test', title: 'Test' }],
      ownership: { nodes: { 'vacp://value': 'vacp-source://test' }, actions: { set: 'vacp-source://test' } },
      nodes: [{ ref: 'vacp://value', kind: 'CustomParameter', layer: 'ConfigLayer' }],
      edges: [],
      actions: [{ name: 'set', description: 'Set value', operation: { kind: 'mutation', affects: ['vacp://value'] } }],
    },
    state: { 'vacp://value': value },
    freshness: { 'vacp://value': { status: 'current' } },
  };
}
export function client(): InspectorClient & { value: number; calls: number } {
  return {
    id: 'session',
    title: 'Session',
    value: 0,
    calls: 0,
    async observe() {
      return observation(this.value);
    },
    async execute(call) {
      this.calls++;
      if (typeof call.params === 'number') this.value = call.params;
      return { callId: call.callId ?? 'assigned', ok: true, result: this.value };
    },
    async restore(snapshot) {
      this.calls++;
      this.value = Number(snapshot['vacp://value']);
      return { callId: 'restore', ok: true, result: this.value };
    },
  };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export function whenState(
  session: InspectorSession,
  matches: (state: InspectorState) => boolean,
): Promise<InspectorState> {
  return new Promise((resolve) => {
    const check = () => {
      if (!matches(session.getState())) return;
      unsubscribe();
      resolve(session.getState());
    };
    const unsubscribe = session.subscribe(check);
    check();
  });
}
