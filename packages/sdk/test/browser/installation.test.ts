import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { VACP_SCHEMA_VERSION } from '../../src/protocol';
import { createVacpProvider, VacpActionRegistry } from '../../src/runtime';
import { getVacpBridge, installVacpRuntime } from '../../src/browser/index';

const key = '__vacp_installation_test';
const installations: Array<{ dispose(): void }> = [];

/** Install at the test key, and dispose every installation after each test even when it fails. */
function install(args: Omit<Parameters<typeof installVacpRuntime>[0], 'globalKey' | 'injectDomSnapshot'>) {
  const installation = installVacpRuntime({ ...args, globalKey: key, injectDomSnapshot: false });
  installations.push(installation);
  return installation;
}

afterEach(() => {
  for (const installation of installations.splice(0).reverse()) installation.dispose();
});

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
  const first = install({ exposeBridge: true, providers: [provider(1)] });
  assert.equal(getVacpBridge({ globalKey: key }), first.runtime);
  const second = install({ exposeBridge: true, providers: [provider(2)] });
  assert.equal(first.runtime, second.runtime);
  const runtime = second.runtime;
  assert.equal((await runtime.observe()).state['vacp://example/value'], 2);
  assert.equal(runtime.runtimeId, runtime.getProvenance().runtimeId);
  let events = 0;
  runtime.subscribeProvenance(() => {
    events += 1;
  });
  first.dispose();
  second.dispose();
  assert.equal(getVacpBridge({ globalKey: key }), undefined);
  await assert.rejects(runtime.record(), /abort/i);
  assert.equal(events, 0);
});

test('browser installation composes distinct source owners at one global key', async () => {
  const { runtime } = install({ exposeBridge: true, providers: [provider(1)] });
  install({ exposeBridge: true, providers: [provider(2, 'other')] });
  const observation = await runtime.observe();
  assert.deepEqual([...runtime.providerIds].sort(), [
    'vacp-source://installation-other',
    'vacp-source://installation-value',
  ]);
  assert.equal(observation.state['vacp://example/value'], 1);
  assert.equal(observation.state['vacp://example/other'], 2);
});

test('an older installation cannot detach a replacement with the same source identity', async () => {
  const first = install({ exposeBridge: true, providers: [provider(1)] });
  const replacement = install({ exposeBridge: true, providers: [provider(2)] });
  first.dispose();
  assert.equal((await replacement.runtime.observe()).state['vacp://example/value'], 2);
  replacement.dispose();
  assert.equal(getVacpBridge({ globalKey: key }), undefined);
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

test('an installation of a disposed runtime cannot uninstall a new runtime at the same key', async () => {
  const first = install({ exposeBridge: true, providers: [provider(1)] });
  first.runtime.dispose();
  const replacement = install({ exposeBridge: true, providers: [provider(2)] });
  assert.notEqual(replacement.runtime, first.runtime);
  first.dispose();
  assert.equal(getVacpBridge({ globalKey: key }), replacement.runtime);
  assert.equal((await replacement.runtime.observe()).state['vacp://example/value'], 2);
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
