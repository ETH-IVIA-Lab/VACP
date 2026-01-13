import type { VacpWindowBridge } from '@vacp/core';
import { VACP_SCHEMA_VERSION } from '@vacp/core';

import { defaultVacpDomSnapshotScriptId, removeVacpDomSnapshotScript, updateVacpDomSnapshotScript } from './dom-snapshot';

export interface VacpWindowBridgeOptions {
  globalKey?: string;
  /**
   * If true, returns a bridge even if `bridge.version` does not match the
   * current `@vacp/core` schema version.
   *
   * Default is strict: version mismatches return `undefined`.
   */
  allowVersionMismatch?: boolean;

  /**
   * If true (default), inject a `type="application/json"` `<script>` tag whose
   * contents are pure JSON containing `{ capabilities, state }`.
   *
   * This makes VACP discoverable to agents that only parse the DOM.
   */
  injectDomSnapshot?: boolean;
  /** Optional override for the injected `<script>` element id. */
  domSnapshotScriptId?: string;
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

  const scriptId = options?.domSnapshotScriptId ?? defaultVacpDomSnapshotScriptId(key);
  if (options?.injectDomSnapshot === false) {
    removeVacpDomSnapshotScript(scriptId);
  } else {
    void updateVacpDomSnapshotScript({
      source: bridge,
      scriptId,
    });
  }
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
  const maybe = value as Partial<VacpWindowBridge>;
  if (
    typeof maybe.getCapabilities !== 'function' ||
    typeof maybe.getState !== 'function' ||
    typeof maybe.execute !== 'function'
  ) {
    return undefined;
  }
  if (!options?.allowVersionMismatch && maybe.version !== VACP_SCHEMA_VERSION) return undefined;
  return maybe as VacpWindowBridge;
}
