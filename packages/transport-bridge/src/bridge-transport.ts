import type { VacpRuntimeBridge } from '@vacp/protocol';

import type { VacpTransport } from './types';

function messageForExecute(action: string): string {
  return `agent:${action}`;
}

async function ensureLiveMode(bridge: VacpRuntimeBridge) {
  if (!bridge.getRuntime || !bridge.setMode) return;

  try {
    const runtime = await bridge.getRuntime();

    if (runtime.mode === 'inspect') bridge.setMode('live', { source: 'agent', message: 'auto:live for execute' });
  } catch {
    // Runtime mode recovery must not block action execution.
  }
}

function capabilitiesAreEmpty(snapshot: Awaited<ReturnType<VacpTransport['vacp_capabilities']>>): boolean {
  return snapshot.graph.nodes.length === 0 && snapshot.graph.actions.length === 0;
}

function stateIsEmpty(snapshot: Awaited<ReturnType<VacpTransport['vacp_state']>>): boolean {
  if ('snapshot' in snapshot && snapshot.snapshot) {
    return Object.keys(snapshot.snapshot.state ?? {}).length === 0;
  }

  if ('state' in snapshot && snapshot.state) {
    return Object.keys(snapshot.state ?? {}).length === 0;
  }

  return true;
}

async function pause(ms: number) {
  await new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

async function waitForRuntimeReadiness(bridge: VacpRuntimeBridge, timeoutMs = 8_000) {
  if (!bridge.getRuntime) return;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const runtime = await bridge.getRuntime();
      const nodeCount = runtime.currentCapabilities?.graph?.nodes?.length ?? 0;
      const actionCount = runtime.currentCapabilities?.graph?.actions?.length ?? 0;
      const stateCount = Object.keys(runtime.currentState?.state ?? {}).length;

      if (nodeCount > 0 || actionCount > 0 || stateCount > 0) return;
    } catch {
      return;
    }

    await pause(500);
  }
}

async function getCapabilitiesWithRefreshFallback(
  bridge: VacpRuntimeBridge,
  options: Parameters<VacpTransport['vacp_capabilities']>[0],
) {
  const read = async () => (!options ? await bridge.getCapabilities() : await bridge.getCapabilities(options));
  const initial = await read();

  if (!capabilitiesAreEmpty(initial)) {
    return initial;
  }

  await waitForRuntimeReadiness(bridge);
  let latest = initial;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      if (bridge.refresh) {
        await bridge.refresh({ source: 'agent', message: 'auto:refresh for capabilities' });
      }

      await pause(500);
      latest = await read();

      if (!capabilitiesAreEmpty(latest)) return latest;
    } catch {
      return latest;
    }
  }

  return latest;
}

async function getStateWithRefreshFallback(
  bridge: VacpRuntimeBridge,
  options: Parameters<VacpTransport['vacp_state']>[0],
) {
  const read = async () => (!options ? await bridge.getState() : await bridge.getState(options));
  const initial = await read();

  if (!stateIsEmpty(initial)) return initial;

  await waitForRuntimeReadiness(bridge);
  let latest = initial;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      if (bridge.refresh) {
        await bridge.refresh({ source: 'agent', message: 'auto:refresh for state' });
      }

      await pause(500);
      latest = await read();

      if (!stateIsEmpty(latest)) return latest;
    } catch {
      return latest;
    }
  }

  return latest;
}

export function createVacpTransport(bridge: VacpRuntimeBridge): VacpTransport {
  return {
    vacp_capabilities: async (options) => await getCapabilitiesWithRefreshFallback(bridge, options),

    vacp_state: async (options) => await getStateWithRefreshFallback(bridge, options),

    vacp_execute: async (name, params, call_id) => {
      const action = name?.trim();

      if (!action) throw new Error('Expected a non-empty action name');

      await ensureLiveMode(bridge);

      const callId = call_id?.trim() || crypto.randomUUID();

      if (bridge.dispatch) {
        return await bridge.dispatch(
          { callId, name: action, params },
          { source: 'agent', message: messageForExecute(action) },
        );
      }

      return await bridge.execute({ callId, name: action, params });
    },
  };
}
