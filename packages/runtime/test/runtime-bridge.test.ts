import { z } from 'zod';
import assert from 'node:assert/strict';
import test from 'node:test';

import type { VacpCapabilitiesSnapshot, VacpStateSnapshot } from '@vacp/protocol';
import { VACP_SCHEMA_VERSION } from '@vacp/protocol';

import { registerVacpApplyStateAction } from '../src/apply-state';
import { VacpActionRegistry } from '../src/action-registry';
import { createVacpRuntime } from '../src/runtime/create-runtime';

const valueSchema = z.object({ value: z.string() });

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
    const next = valueSchema.parse(state[ref]).value;

    if (next === 'old') {
      oldReplayStarted();
      await oldReplayReleased;
    }

    hostValue = next;
  });

  const bridge = createVacpRuntime({
    actions,
    snapshots: {
      getCapabilities: async () => capabilities(actions),
      getState: async () => stateSnapshot(hostValue),
    },
  });

  await bridge.refresh({ source: 'inspector', message: 'old snapshot' });
  hostValue = 'live';
  await bridge.refresh({ source: 'inspector', message: 'live snapshot' });

  bridge.setCursor(0, { source: 'inspector', message: 'inspect old' });
  await oldReplayInFlight;

  bridge.setMode('live', { source: 'inspector', message: 'return live while inspect replay is in flight' });
  releaseOldReplay();

  await waitFor(async () => (await bridge.getRuntime()).mode === 'live', 'live runtime mode');

  const runtime = await bridge.getRuntime();
  assert.equal(hostValue, 'live');
  assert.equal(valueSchema.parse(runtime.liveState.state[ref]).value, 'live');
  assert.equal(valueSchema.parse(runtime.currentState.state[ref]).value, 'live');
});

test('Return to Live restores observed live state even when it was not recorded in history', async () => {
  let hostValue = 'old';
  const actions = new VacpActionRegistry();
  registerVacpApplyStateAction(actions, async (state) => {
    const next = valueSchema.parse(state[ref]).value;

    hostValue = next;
  });

  const bridge = createVacpRuntime({
    actions,
    snapshots: {
      getCapabilities: async () => capabilities(actions),
      getState: async () => stateSnapshot(hostValue),
    },
  });

  await bridge.refresh({ source: 'inspector', message: 'recorded old snapshot' });
  hostValue = 'live-unrecorded';

  const observed = await bridge.getRuntime();
  assert.equal(valueSchema.parse(observed.liveState.state[ref]).value, 'live-unrecorded');
  assert.deepEqual(
    observed.history.map((entry) =>
      entry.kind === 'snapshot' ? valueSchema.parse(entry.state?.state[ref]).value : undefined,
    ),
    ['old'],
  );

  bridge.setCursor(0, { source: 'inspector', message: 'inspect recorded old' });
  await waitFor(async () => hostValue === 'old', 'inspect replay to old host state');

  bridge.setMode('live', { source: 'inspector', message: 'return to unrecorded live state' });
  await waitFor(async () => (await bridge.getRuntime()).mode === 'live', 'live runtime mode');

  const runtime = await bridge.getRuntime();
  assert.equal(hostValue, 'live-unrecorded');
  assert.equal(valueSchema.parse(runtime.liveState.state[ref]).value, 'live-unrecorded');
  assert.equal(valueSchema.parse(runtime.currentState.state[ref]).value, 'live-unrecorded');
});
