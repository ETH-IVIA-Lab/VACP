import assert from 'node:assert/strict';
import test from 'node:test';
import { VACP_SCHEMA_VERSION } from '@vacp/protocol';
import { createVacpProvider, VacpActionRegistry } from '@vacp/runtime';
import { getVacpBridge, installVacpRuntime, uninstallVacpRuntime } from '../src/index';

const key = '__vacp_installation_test';

const provider = (value: number, id = 'value') =>
  createVacpProvider({
    source: { id: `vacp-source://installation-${id}`, type: 'test', title: `Installation ${id}` },
    actions: new VacpActionRegistry(),
    project: () => ({
      graph: {
        version: VACP_SCHEMA_VERSION,
        nodes: [{ ref: `vacp://example/${id}` as const, kind: 'Param', layer: 'ConfigLayer' }],
        edges: [],
      },
      state: { [`vacp://example/${id}`]: value },
    }),
  });

test('browser installation preserves bridge identity while replacing provider ports', async () => {
  try {
    const first = installVacpRuntime({ globalKey: key, providers: [provider(1)], injectDomSnapshot: false }).runtime;
    assert.equal(getVacpBridge({ globalKey: key }), first);
    const second = installVacpRuntime({ globalKey: key, providers: [provider(2)], injectDomSnapshot: false }).runtime;
    assert.equal(first, second);
    assert.equal((await second.getState()).state['vacp://example/value'], 2);
    assert.equal(first.runtimeId, (await first.getRuntime()).runtimeId);
    let events = 0;
    first.subscribe(() => {
      events += 1;
    });
    uninstallVacpRuntime({ globalKey: key });
    assert.equal(getVacpBridge({ globalKey: key }), undefined);
    await assert.rejects(first.refresh(), /abort/i);
    assert.equal(events, 0);
  } finally {
    uninstallVacpRuntime({ globalKey: key });
  }
});

test('browser installation composes distinct source owners at one global key', async () => {
  try {
    const runtime = installVacpRuntime({ globalKey: key, providers: [provider(1)], injectDomSnapshot: false }).runtime;
    installVacpRuntime({ globalKey: key, providers: [provider(2, 'other')], injectDomSnapshot: false });
    const observation = await runtime.observe();
    assert.deepEqual(runtime.providerIds.sort(), [
      'vacp-source://installation-other',
      'vacp-source://installation-value',
    ]);
    assert.equal(observation.state['vacp://example/value'], 1);
    assert.equal(observation.state['vacp://example/other'], 2);
  } finally {
    uninstallVacpRuntime({ globalKey: key });
  }
});

test('an older installation cannot detach a replacement with the same source identity', async () => {
  try {
    const first = installVacpRuntime({ globalKey: key, providers: [provider(1)], injectDomSnapshot: false });
    const replacement = installVacpRuntime({ globalKey: key, providers: [provider(2)], injectDomSnapshot: false });
    first.dispose();
    assert.equal((await replacement.runtime.getState()).state['vacp://example/value'], 2);
    replacement.dispose();
    assert.equal(getVacpBridge({ globalKey: key }), undefined);
  } finally {
    uninstallVacpRuntime({ globalKey: key });
  }
});

test('browser discovery requires the complete versioned protocol surface', () => {
  Object.assign(globalThis, {
    [key]: { version: VACP_SCHEMA_VERSION, getCapabilities() {}, getState() {}, execute() {} },
  });

  try {
    assert.equal(getVacpBridge({ globalKey: key }), undefined);
  } finally {
    Reflect.deleteProperty(globalThis, key);
  }
});
