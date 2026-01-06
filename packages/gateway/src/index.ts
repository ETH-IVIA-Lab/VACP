import type {
  VacpActionCall,
  VacpActionDescriptor,
  VacpActionResult,
  VacpCapabilitiesSnapshot,
  VacpStateSnapshot,
  VacpWindowBridge,
} from '@vacp/core';
import { VACP_SCHEMA_VERSION } from '@vacp/core';

export type VacpActionHandler = (params: unknown) => unknown | Promise<unknown>;

/**
 * Action registry (concepts).
 *
 * Providers register *semantic* actions here (e.g. "set_interval_2d") rather
 * than wiring agents to DOM events. This is the core of the VACP "control
 * plane".
 *
 * Actions should be a small, explicit set of validated operations the UI
 * intentionally exposes; not arbitrary code execution.
 */
export class VacpActionRegistry {
  private readonly descriptors = new Map<string, VacpActionDescriptor>();
  private readonly handlers = new Map<string, VacpActionHandler>();

  register(descriptor: VacpActionDescriptor, handler: VacpActionHandler): void {
    if (this.handlers.has(descriptor.name)) {
      throw new Error(
        `Duplicate action registration for "${descriptor.name}". Register each action name once (handlers should route via params).`,
      );
    }
    this.descriptors.set(descriptor.name, descriptor);
    this.handlers.set(descriptor.name, handler);
  }

  unregister(name: string): void {
    this.descriptors.delete(name);
    this.handlers.delete(name);
  }

  list(): VacpActionDescriptor[] {
    return Array.from(this.descriptors.values());
  }

  async execute(call: VacpActionCall): Promise<VacpActionResult> {
    const handler = this.handlers.get(call.name);
    if (!handler) {
      return { callId: call.callId, ok: false, error: { message: `Unknown action: ${call.name}` } };
    }
    try {
      const result = await handler(call.params);
      return { callId: call.callId, ok: true, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { callId: call.callId, ok: false, error: { message, details: error } };
    }
  }
}

export interface VacpWindowBridgeOptions {
  globalKey?: string;
}

/**
 * Installs a VACP window bridge (default: `window.__vacp`).
 *
 * This is the preferred integration path for dynamic apps:
 * - the MCP server queries canonical JSON snapshots
 * - no DOM scanning is needed for discovery/state/control
 */
export function installVacpWindowBridge(bridge: VacpWindowBridge, options?: VacpWindowBridgeOptions): void {
  const key = options?.globalKey ?? '__vacp';
  (globalThis as unknown as Record<string, unknown>)[key] = bridge;
}

/**
 * Reads a previously-installed bridge from `window`.
 *
 * Consumers should treat the returned object as untrusted input if they did
 * not install it themselves.
 */
export function getVacpWindowBridge(options?: VacpWindowBridgeOptions): VacpWindowBridge | undefined {
  const key = options?.globalKey ?? '__vacp';
  const value = (globalThis as unknown as Record<string, unknown>)[key];
  if (!value || typeof value !== 'object') return undefined;
  const bridge = value as VacpWindowBridge;
  return bridge.version === VACP_SCHEMA_VERSION ? bridge : bridge;
}

export interface VacpSnapshotProvider {
  getCapabilities(): VacpCapabilitiesSnapshot | Promise<VacpCapabilitiesSnapshot>;
  getState(): VacpStateSnapshot | Promise<VacpStateSnapshot>;
}

/**
 * Helper to build a window bridge from a snapshot provider + action registry.
 * This is intended for in-browser integrations (e.g., Mosaic/vgplot).
 *
 * Conceptually this creates the "agent-facing API surface" for an app:
 * - capabilities() to discover nodes/actions
 * - state() to read current selections/params
 * - execute() to request semantic interactions
 */
export function createVacpWindowBridge({
  snapshots,
  actions,
}: {
  snapshots: VacpSnapshotProvider;
  actions: VacpActionRegistry;
}): VacpWindowBridge {
  return {
    version: VACP_SCHEMA_VERSION,
    getCapabilities: () => snapshots.getCapabilities(),
    getState: () => snapshots.getState(),
    execute: (call: VacpActionCall) => actions.execute(call),
  };
}
