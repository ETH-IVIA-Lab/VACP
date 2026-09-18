import type { InspectorClient, InspectorSession, InspectorState } from '../src/index';
import { VACP_SCHEMA_VERSION, type VacpObservation } from '@vacp/protocol';

export function observation(value = 0): VacpObservation {
  return {
    version: VACP_SCHEMA_VERSION,
    revision: String(value),
    observedAt: '2026-09-18T12:00:00Z',
    graph: {
      version: VACP_SCHEMA_VERSION,
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
export function client(): InspectorClient<number, number> & { value: number; calls: number } {
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
      this.value = call.params ?? this.value;
      return { callId: call.callId, ok: true, result: this.value };
    },
    async restore(snapshot) {
      this.calls++;
      this.value = Number(snapshot.state['vacp://value']);
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

export function whenState<Params, Result>(
  session: InspectorSession<Params, Result>,
  matches: (state: InspectorState<Params, Result>) => boolean,
): Promise<InspectorState<Params, Result>> {
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
