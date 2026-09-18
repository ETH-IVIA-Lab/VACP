import { readExposedRuntime } from './bridge';
import { createVacpRuntime, type VacpActionExecutor, type VacpRuntime, type VacpSnapshotProvider } from '@vacp/runtime';
import { getVacpBrowserOptions } from './options';
import { type VacpRuntimeBridge } from '@vacp/protocol';

import {
  defaultVacpDomSnapshotScriptId,
  removeVacpDomSnapshotScript,
  updateVacpDomSnapshotScript,
  writeVacpDomSnapshotScript,
  type VacpDomSnapshotSource,
} from './dom-snapshot';
import { purgeVacpWindowGlobals, resolveVacpGlobalKey } from './window-globals';

const HIDDEN_RUNTIME_BRIDGES = new Map<string, VacpRuntime>();

type DomSnapshotState = {
  enabled: boolean;
  scriptId: string;
  source: VacpDomSnapshotSource;
};

const domSnapshotHooks = new WeakMap<VacpRuntimeBridge, DomSnapshotState>();

function installDomSnapshotHooks(bridge: VacpRuntimeBridge, state: DomSnapshotState): void {
  const b = bridge;
  const installed = domSnapshotHooks.has(bridge);
  domSnapshotHooks.set(bridge, state);

  if (installed) return;

  const originalRefresh = b.refresh?.bind(b);

  if (originalRefresh) {
    b.refresh = async (options) => {
      const st = await originalRefresh(options);
      const s = domSnapshotHooks.get(b);

      if (s?.enabled) {
        try {
          const cap = await s.source.getCapabilities();
          writeVacpDomSnapshotScript({ scriptId: s.scriptId, capabilities: cap, state: st });
        } catch {
          // ignore
        }
      }

      return st;
    };
  }

  const originalExecute = b.execute?.bind(b);

  if (originalExecute) {
    b.execute = async (call) => {
      const res = await originalExecute(call);
      const s = domSnapshotHooks.get(b);

      if (s?.enabled) void updateVacpDomSnapshotScript({ source: s.source, scriptId: s.scriptId });

      return res;
    };
  }
}

/**
 * Install-or-update a runtime bridge at a given global key (default `__vacp`).
 *
 * This keeps `window.__vacp` stable across rerenders and view switches:
 * - the bridge object stays the same
 * - providers update the underlying snapshot/action adapters
 * - history remains continuous by default (enables real time travel and replay)
 *
 * If `sessionKey` is provided and changes between installs, the runtime bridge
 * will treat it as a new session and reset its history.
 */
export function installVacpRuntime(args: {
  snapshots: VacpSnapshotProvider;
  actions: VacpActionExecutor;
  globalKey?: string;
  sessionKey?: string;
  runtimeId?: string;
  /**
   * If true (default), inject a `type="application/json"` `<script>` tag whose
   * contents are pure JSON containing `{ capabilities, state }`.
   *
   * This makes VACP discoverable to agents that only parse the DOM.
   */
  injectDomSnapshot?: boolean;
  /** Optional override for the injected `<script>` element id. */
  domSnapshotScriptId?: string;
}): VacpRuntime {
  const key = resolveVacpGlobalKey(args.globalKey);
  const exposeBridge = getVacpBrowserOptions().exposeBridge;
  const domSnapshotEnabled = args.injectDomSnapshot ?? getVacpBrowserOptions().domSnapshot;
  const domSnapshotScriptId = args.domSnapshotScriptId ?? defaultVacpDomSnapshotScriptId(key);

  if (!domSnapshotEnabled) removeVacpDomSnapshotScript(domSnapshotScriptId);

  const exposed = readExposedRuntime(key);

  if (!exposeBridge) {
    // Move an existing runtime bridge off `window` so history can remain stable,
    // then purge all `window[${globalKey}*]` globals for hardening.
    const existingFromWindow = exposed;

    if (existingFromWindow) HIDDEN_RUNTIME_BRIDGES.set(key, existingFromWindow);
    purgeVacpWindowGlobals(key);
  }

  const existingFromWindow = exposed;
  const existingFromHidden = HIDDEN_RUNTIME_BRIDGES.get(key);
  const existing = (exposeBridge ? existingFromWindow : existingFromHidden) ?? existingFromHidden ?? existingFromWindow;

  if (existing) {
    if (exposeBridge) {
      Object.assign(globalThis, { [key]: existing });
      HIDDEN_RUNTIME_BRIDGES.delete(key);
    } else {
      HIDDEN_RUNTIME_BRIDGES.set(key, existing);
    }

    existing.update({
      snapshots: args.snapshots,
      actions: args.actions,
      sessionKey: args.sessionKey,
    });
    installDomSnapshotHooks(existing, {
      enabled: domSnapshotEnabled,
      scriptId: domSnapshotScriptId,
      source: args.snapshots,
    });

    if (domSnapshotEnabled) void updateVacpDomSnapshotScript({ source: args.snapshots, scriptId: domSnapshotScriptId });

    return existing;
  }

  const bridge = createVacpRuntime({
    snapshots: args.snapshots,
    actions: args.actions,
    sessionKey: args.sessionKey,
    runtimeId: args.runtimeId,
  });

  if (exposeBridge) {
    Object.assign(globalThis, { [key]: bridge });
    HIDDEN_RUNTIME_BRIDGES.delete(key);
  } else {
    HIDDEN_RUNTIME_BRIDGES.set(key, bridge);
  }

  installDomSnapshotHooks(bridge, {
    enabled: domSnapshotEnabled,
    scriptId: domSnapshotScriptId,
    source: args.snapshots,
  });

  if (domSnapshotEnabled) void updateVacpDomSnapshotScript({ source: args.snapshots, scriptId: domSnapshotScriptId });

  return bridge;
}

export function uninstallVacpRuntime(options?: { globalKey?: string }): void {
  const key = resolveVacpGlobalKey(options?.globalKey);
  const exposed = readExposedRuntime(key);
  const candidate = exposed ?? HIDDEN_RUNTIME_BRIDGES.get(key);

  if (!candidate) return;
  candidate.dispose();
  const snapshot = domSnapshotHooks.get(candidate);

  if (snapshot) removeVacpDomSnapshotScript(snapshot.scriptId);
  domSnapshotHooks.delete(candidate);
  HIDDEN_RUNTIME_BRIDGES.delete(key);

  if (exposed === candidate) Reflect.deleteProperty(globalThis, key);
}
