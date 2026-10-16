import assert from 'node:assert/strict';
import test from 'node:test';
import { VACP_SCHEMA_VERSION } from '@vacp/protocol';
import { createVacpProvider, VacpActionRegistry } from '@vacp/runtime';
import { getVacpBridge, installVacpRuntime, uninstallVacpRuntime } from '../src/index';

const key = '__vacp_installation_test';

const provider = (value: number, id = 'value') =>
  createVacpProvider({
    subscribe: () => () => {},
    source: { id: `vacp-source://installation-${id}`, type: 'test', title: `Installation ${id}` },
    actions: new VacpActionRegistry(),
    project: () => ({
      graph: {
        nodes: [{ ref: `vacp://example/${id}` as const, kind: 'Param', layer: 'ConfigLayer' }],
        edges: [],
        actions: [],
      },
      state: { [`vacp://example/${id}`]: value },
    }),
  });

test('browser installation preserves bridge identity while replacing provider ports', async () => {
  try {
    const first = installVacpRuntime({
      exposeBridge: true,
      globalKey: key,
      providers: [provider(1)],
      injectDomSnapshot: false,
    }).runtime;
    assert.equal(getVacpBridge({ globalKey: key }), first);
    const second = installVacpRuntime({
      exposeBridge: true,
      globalKey: key,
      providers: [provider(2)],
      injectDomSnapshot: false,
    }).runtime;
    assert.equal(first, second);
    assert.equal((await second.observe()).state['vacp://example/value'], 2);
    assert.equal(first.runtimeId, first.getProvenance().runtimeId);
    let events = 0;
    first.subscribeProvenance(() => {
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
    const runtime = installVacpRuntime({
      exposeBridge: true,
      globalKey: key,
      providers: [provider(1)],
      injectDomSnapshot: false,
    }).runtime;
    installVacpRuntime({
      exposeBridge: true,
      globalKey: key,
      providers: [provider(2, 'other')],
      injectDomSnapshot: false,
    });
    const observation = await runtime.observe();
    assert.deepEqual([...runtime.providerIds].sort(), [
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
    const first = installVacpRuntime({
      exposeBridge: true,
      globalKey: key,
      providers: [provider(1)],
      injectDomSnapshot: false,
    });
    const replacement = installVacpRuntime({
      exposeBridge: true,
      globalKey: key,
      providers: [provider(2)],
      injectDomSnapshot: false,
    });
    first.dispose();
    assert.equal((await replacement.runtime.observe()).state['vacp://example/value'], 2);
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

test('a disposed installation cannot uninstall a new runtime at the same key', async () => {
  const first = installVacpRuntime({
    exposeBridge: true,
    globalKey: key,
    providers: [provider(1)],
    injectDomSnapshot: false,
  });
  uninstallVacpRuntime({ globalKey: key });
  const replacement = installVacpRuntime({
    exposeBridge: true,
    globalKey: key,
    providers: [provider(2)],
    injectDomSnapshot: false,
  });
  try {
    first.dispose();
    assert.equal(getVacpBridge({ globalKey: key }), replacement.runtime);
    assert.equal((await replacement.runtime.observe()).state['vacp://example/value'], 2);
  } finally {
    replacement.dispose();
  }
});

test('failed source groups leave installation, session, and exposure unchanged', async () => {
  const first = installVacpRuntime({
    exposeBridge: true,
    globalKey: key,
    providers: [provider(1)],
    sessionKey: 'original',
    injectDomSnapshot: false,
  });
  const failing = {
    ...provider(3, 'failing'),
    subscribe: () => {
      throw new Error('Cannot subscribe');
    },
  };
  try {
    assert.throws(
      () =>
        installVacpRuntime({
          globalKey: key,
          providers: [provider(2), failing],
          injectDomSnapshot: false,
          exposeBridge: false,
        }),
      /Cannot subscribe/,
    );
    assert.throws(
      () =>
        installVacpRuntime({
          exposeBridge: true,
          globalKey: key,
          providers: [provider(2), failing],
          sessionKey: 'replacement',
          injectDomSnapshot: false,
        }),
      /Cannot subscribe/,
    );
    assert.equal(getVacpBridge({ globalKey: key }), first.runtime);
    assert.equal(first.runtime.sessionKey, 'original');
    assert.equal((await first.runtime.observe()).state['vacp://example/value'], 1);
    assert.deepEqual(first.runtime.providerIds, ['vacp-source://installation-value']);
  } finally {
    first.dispose();
  }
  assert.throws(
    () =>
      installVacpRuntime({
        exposeBridge: true,
        globalKey: key,
        providers: [provider(2), failing],
        injectDomSnapshot: false,
      }),
    /Cannot subscribe/,
  );
  assert.equal(getVacpBridge({ globalKey: key }), undefined);
});

test('batch cleanup preserves newer leases, even when the provider instance is reused', async () => {
  const shared = provider(1);
  const first = installVacpRuntime({
    exposeBridge: true,
    globalKey: key,
    providers: [shared, provider(2, 'other')],
    injectDomSnapshot: false,
  });
  const second = installVacpRuntime({
    exposeBridge: true,
    globalKey: key,
    providers: [shared],
    injectDomSnapshot: false,
  });
  try {
    first.dispose();
    assert.deepEqual(second.runtime.providerIds, [shared.source.id]);
    assert.equal((await second.runtime.observe()).state['vacp://example/value'], 1);
  } finally {
    second.dispose();
    first.dispose();
  }
  assert.equal(getVacpBridge({ globalKey: key }), undefined);
});
