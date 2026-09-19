import type { VacpProvider } from '@vacp/protocol';
import { createVacpRuntime, type VacpRuntime } from '@vacp/runtime';
import {
  defaultVacpDomSnapshotScriptId,
  removeVacpDomSnapshotScript,
  writeVacpDomSnapshotScript,
} from './dom-snapshot.js';
import { resolveVacpGlobalKey } from './window-globals.js';

const runtimes = new Map<string, VacpRuntime>();
const domSnapshotHooks = new WeakMap<VacpRuntime, () => void>();

function installDomSnapshotHooks(runtime: VacpRuntime, options: { enabled: boolean; scriptId: string }): void {
  domSnapshotHooks.get(runtime)?.();
  if (!options.enabled) return;

  const unsubscribe = runtime.subscribeSnapshots(({ observation, capabilities, state }) => {
    writeVacpDomSnapshotScript({ scriptId: options.scriptId, observation, capabilities, state });
  });
  const dispose = () => {
    unsubscribe();
    removeVacpDomSnapshotScript(options.scriptId);
    runtime.signal.removeEventListener('abort', dispose);
    if (domSnapshotHooks.get(runtime) === dispose) domSnapshotHooks.delete(runtime);
  };
  domSnapshotHooks.set(runtime, dispose);
  runtime.signal.addEventListener('abort', dispose, { once: true });
  void Promise.resolve(runtime.getCapabilities()).catch(() => {});
}

/**
 * Install-or-update a runtime bridge at a given global key (default `__vacp`).
 *
 * This keeps `window.__vacp` stable across rerenders and view switches:
 * - the bridge object stays the same
 * - providers update the underlying snapshot/action adapters
 * - history remains continuous within a session for independent inspection
 *
 * If `sessionKey` is provided and changes between installs, the runtime bridge
 * will treat it as a new session and reset its history.
 */
export function installVacpRuntime(args: {
  providers: readonly VacpProvider[];
  globalKey?: string;
  sessionKey?: string;
  runtimeId?: string;
  /** Publish the runtime at the chosen window key. Defaults to true. */
  exposeBridge?: boolean;
  /**
   * If true (default), inject a `type="application/json"` `<script>` tag whose
   * contents are pure JSON containing `{ capabilities, state }`.
   *
   * This makes VACP discoverable to agents that only parse the DOM.
   */
  injectDomSnapshot?: boolean;
  /** Optional override for the injected `<script>` element id. */
  domSnapshotScriptId?: string;
}): { runtime: VacpRuntime; dispose: () => void } {
  const key = resolveVacpGlobalKey(args.globalKey);
  const exposeBridge = args.exposeBridge ?? true;
  const domSnapshotEnabled = args.injectDomSnapshot ?? true;
  const domSnapshotScriptId = args.domSnapshotScriptId ?? defaultVacpDomSnapshotScriptId(key);

  let runtime = runtimes.get(key);
  if (runtime?.signal.aborted) runtime = undefined;
  if (!runtime) {
    runtime = createVacpRuntime({ providers: args.providers, sessionKey: args.sessionKey, runtimeId: args.runtimeId });
  } else if (args.sessionKey && args.sessionKey !== runtime.sessionKey) {
    runtime.update({ providers: args.providers, sessionKey: args.sessionKey });
  }
  const detach = runtime.attachProviders(args.providers);
  runtimes.set(key, runtime);
  if (exposeBridge) Object.assign(globalThis, { [key]: runtime });
  else if (Object.getOwnPropertyDescriptor(globalThis, key)?.value === runtime) Reflect.deleteProperty(globalThis, key);
  installDomSnapshotHooks(runtime, { enabled: domSnapshotEnabled, scriptId: domSnapshotScriptId });

  let disposed = false;
  return {
    runtime,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      detach();
      if (runtimes.get(key) === runtime && runtime.providerIds.length === 0) {
        uninstallVacpRuntime({ globalKey: key });
      }
    },
  };
}

export function uninstallVacpRuntime(options?: { globalKey?: string }): void {
  const key = resolveVacpGlobalKey(options?.globalKey);
  const runtime = runtimes.get(key);
  if (!runtime) return;
  runtimes.delete(key);
  runtime.dispose();
  if (Object.getOwnPropertyDescriptor(globalThis, key)?.value === runtime) Reflect.deleteProperty(globalThis, key);
}
