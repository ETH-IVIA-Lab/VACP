import assert from 'node:assert/strict';
import test from 'node:test';
import { VACP_SCHEMA_VERSION } from '@vacp/protocol';
import { getVacpBridge, installVacpRuntime, uninstallVacpRuntime } from '../src/index';

const key = '__vacp_installation_test';

const actions = { list: () => [], execute: async (call: { callId: string }) => ({ callId: call.callId, ok: true }) };

const snapshots = (value: number) => ({
  getCapabilities: () => ({
    version: VACP_SCHEMA_VERSION,
    createdAt: '',
    graph: { version: VACP_SCHEMA_VERSION, nodes: [], edges: [], actions: [] },
  }),
  getState: () => ({ version: VACP_SCHEMA_VERSION, createdAt: '', state: { 'vacp://example/value': value } }),
});

test('browser installation preserves bridge identity while replacing provider ports', async () => {
  try {
    const first = installVacpRuntime({ globalKey: key, snapshots: snapshots(1), actions, injectDomSnapshot: false });
    assert.equal(getVacpBridge({ globalKey: key }), first);
    const second = installVacpRuntime({ globalKey: key, snapshots: snapshots(2), actions, injectDomSnapshot: false });
    assert.equal(first, second);
    assert.equal((await second.getState()).state['vacp://example/value'], 2);
    assert.equal(first.runtimeId, (await first.getRuntime()).runtimeId);
    let events = 0;
    first.subscribe(() => {
      events += 1;
    });
    uninstallVacpRuntime({ globalKey: key });
    assert.equal(getVacpBridge({ globalKey: key }), undefined);
    await first.refresh();
    assert.equal(events, 0);
  } finally {
    uninstallVacpRuntime({ globalKey: key });
  }
});

test('browser discovery requires the complete versioned protocol surface', () => {
  Object.assign(globalThis, { [key]: { version: VACP_SCHEMA_VERSION, getCapabilities() {}, getState() {} } });

  try {
    assert.equal(getVacpBridge({ globalKey: key }), undefined);
  } finally {
    Reflect.deleteProperty(globalThis, key);
  }
});
