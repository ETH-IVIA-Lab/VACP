import assert from 'node:assert/strict';
import test from 'node:test';

import type { VacpCapabilitiesSnapshot, VacpStateSnapshot } from '@vacp/core';
import { VACP_SCHEMA_VERSION } from '@vacp/core';

import { registerVacpApplyStateAction } from '../src/apply-state';
import { VacpActionRegistry } from '../src/action-registry';
import { createRuntimeBridge } from '../src/runtime/create-runtime-bridge';

const ref = 'vacp://test/input/0';

function stateSnapshot(value: string): VacpStateSnapshot {
  return {
    version: VACP_SCHEMA_VERSION,
    createdAt: '2026-06-10T00:00:00.000Z',
    state: {
      [ref]: { kind: 'Widget', value },
    },
  };
}

function capabilities(actions: VacpActionRegistry): VacpCapabilitiesSnapshot {
  return {
    version: VACP_SCHEMA_VERSION,
    createdAt: '2026-06-10T00:00:00.000Z',
    graph: {
      version: VACP_SCHEMA_VERSION,
      nodes: [],
      edges: [],
      actions: actions.list(),
    },
  };
}

async function waitFor(predicate: () => Promise<boolean>, label: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

test('Return to Live wins over a slow in-flight inspect replay', async () => {
  let hostValue = 'old';
  let releaseOldReplay!: () => void;
  const oldReplayReleased = new Promise<void>((resolve) => {
    releaseOldReplay = resolve;
  });
  let oldReplayStarted!: () => void;
  const oldReplayInFlight = new Promise<void>((resolve) => {
    oldReplayStarted = resolve;
  });

  const actions = new VacpActionRegistry();
  registerVacpApplyStateAction(actions, async (state) => {
    const next = (state[ref] as { value?: string } | undefined)?.value;
    if (next === 'old') {
      oldReplayStarted();
      await oldReplayReleased;
    }
    if (typeof next === 'string') hostValue = next;
  });

  const bridge = createRuntimeBridge({
    actions,
    snapshots: {
      getCapabilities: async () => capabilities(actions),
      getState: async () => stateSnapshot(hostValue),
    },
  });

  await bridge.refresh({ source: 'debug', message: 'old snapshot' });
  hostValue = 'live';
  await bridge.refresh({ source: 'debug', message: 'live snapshot' });

  bridge.setCursor(0, { source: 'debug', message: 'inspect old' });
  await oldReplayInFlight;

  bridge.setMode('live', { source: 'debug', message: 'return live while inspect replay is in flight' });
  releaseOldReplay();

  await waitFor(async () => (await bridge.getRuntime()).mode === 'live', 'live runtime mode');

  const runtime = await bridge.getRuntime();
  assert.equal(hostValue, 'live');
  assert.equal((runtime.liveState.state[ref] as { value?: string }).value, 'live');
  assert.equal((runtime.currentState.state[ref] as { value?: string }).value, 'live');
});

test('Return to Live restores observed live state even when it was not recorded in history', async () => {
  let hostValue = 'old';
  const actions = new VacpActionRegistry();
  registerVacpApplyStateAction(actions, async (state) => {
    const next = (state[ref] as { value?: string } | undefined)?.value;
    if (typeof next === 'string') hostValue = next;
  });

  const bridge = createRuntimeBridge({
    actions,
    snapshots: {
      getCapabilities: async () => capabilities(actions),
      getState: async () => stateSnapshot(hostValue),
    },
  });

  await bridge.refresh({ source: 'debug', message: 'recorded old snapshot' });
  hostValue = 'live-unrecorded';

  const observed = await bridge.getRuntime();
  assert.equal((observed.liveState.state[ref] as { value?: string }).value, 'live-unrecorded');
  assert.deepEqual(
    observed.history.map((entry) => (entry.kind === 'snapshot' ? (entry.state?.state[ref] as { value?: string })?.value : undefined)),
    ['old'],
  );

  bridge.setCursor(0, { source: 'debug', message: 'inspect recorded old' });
  await waitFor(async () => hostValue === 'old', 'inspect replay to old host state');

  bridge.setMode('live', { source: 'debug', message: 'return to unrecorded live state' });
  await waitFor(async () => (await bridge.getRuntime()).mode === 'live', 'live runtime mode');

  const runtime = await bridge.getRuntime();
  assert.equal(hostValue, 'live-unrecorded');
  assert.equal((runtime.liveState.state[ref] as { value?: string }).value, 'live-unrecorded');
  assert.equal((runtime.currentState.state[ref] as { value?: string }).value, 'live-unrecorded');
});
