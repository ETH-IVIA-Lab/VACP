import { getVacpHyperParams, type VacpPlaybook, type VacpRuntimeBridge } from '@vacp/core';

import { VacpActionRegistry } from '../action-registry';
import type { VacpUpdatableRuntimeBridge } from './types';
import { createRuntimeBridge } from './create-runtime-bridge';
import type { VacpSnapshotProvider } from './types';
import { isUpdatableRuntimeBridge } from './window-runtime-bridge';
import {
  defaultVacpDomSnapshotScriptId,
  removeVacpDomSnapshotScript,
  updateVacpDomSnapshotScript,
  writeVacpDomSnapshotScript,
  type VacpDomSnapshotSource,
} from '../dom-snapshot';

const HIDDEN_RUNTIME_BRIDGES = new Map<string, VacpUpdatableRuntimeBridge>();

type DomSnapshotState = {
  enabled: boolean;
  scriptId: string;
  source: VacpDomSnapshotSource;
};

function installDomSnapshotHooks(bridge: VacpRuntimeBridge, state: DomSnapshotState): void {
  const b = bridge as VacpUpdatableRuntimeBridge & {
    __vacpDomSnapshot?: DomSnapshotState;
    __vacpDomSnapshotPatched?: boolean;
  };

  b.__vacpDomSnapshot = state;
  if (b.__vacpDomSnapshotPatched) return;
  b.__vacpDomSnapshotPatched = true;

  const originalRefresh = b.refresh?.bind(b);
  if (originalRefresh) {
    b.refresh = async (options) => {
      const st = await originalRefresh(options);
      const s = b.__vacpDomSnapshot;
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
      const s = b.__vacpDomSnapshot;
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
export function installVacpRuntimeBridge(args: {
  snapshots: VacpSnapshotProvider;
  actions: VacpActionRegistry;
  playbooks?: VacpPlaybook[];
  globalKey?: string;
  sessionKey?: string;
  /**
   * If true (default), inject a `type="application/json"` `<script>` tag whose
   * contents are pure JSON containing `{ capabilities, state }`.
   *
   * This makes VACP discoverable to agents that only parse the DOM.
   */
  injectDomSnapshot?: boolean;
  /** Optional override for the injected `<script>` element id. */
  domSnapshotScriptId?: string;
}): VacpRuntimeBridge {
  const key = args.globalKey ?? '__vacp';
  const exposeBridge = getVacpHyperParams().exposeBridge;
  const domSnapshotEnabled = args.injectDomSnapshot ?? getVacpHyperParams().domSnapshot;
  const domSnapshotScriptId = args.domSnapshotScriptId ?? defaultVacpDomSnapshotScriptId(key);
  if (!domSnapshotEnabled) removeVacpDomSnapshotScript(domSnapshotScriptId);

  const root = globalThis as unknown as Record<string, unknown>;
  if (!exposeBridge) {
    try {
      delete root[key];
    } catch {
      root[key] = undefined;
    }
  }

  const existingFromWindow = root[key];
  const existingFromHidden = HIDDEN_RUNTIME_BRIDGES.get(key);
  const existing = (exposeBridge ? existingFromWindow : existingFromHidden) ?? existingFromHidden ?? existingFromWindow;

  if (isUpdatableRuntimeBridge(existing)) {
    if (exposeBridge) {
      root[key] = existing;
      HIDDEN_RUNTIME_BRIDGES.delete(key);
    } else {
      HIDDEN_RUNTIME_BRIDGES.set(key, existing);
    }
    existing.__vacpUpdate?.({
      snapshots: args.snapshots,
      actions: args.actions,
      playbooks: args.playbooks,
      sessionKey: args.sessionKey,
    });
    installDomSnapshotHooks(existing as VacpRuntimeBridge, {
      enabled: domSnapshotEnabled,
      scriptId: domSnapshotScriptId,
      source: args.snapshots,
    });
    if (domSnapshotEnabled) void updateVacpDomSnapshotScript({ source: args.snapshots, scriptId: domSnapshotScriptId });
    return existing as VacpRuntimeBridge;
  }
  const bridge = createRuntimeBridge({
    snapshots: args.snapshots,
    actions: args.actions,
    playbooks: args.playbooks,
    sessionKey: args.sessionKey,
  });
  if (exposeBridge) {
    root[key] = bridge;
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
