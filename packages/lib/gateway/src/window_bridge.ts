import type { VacpWindowBridge } from '@vacp/core';
import { VACP_SCHEMA_VERSION } from '@vacp/core';

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
