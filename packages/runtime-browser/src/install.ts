import type { VacpProvider } from '@ethivia/vacp-protocol';
import { createVacpRuntime, type VacpRuntime } from '@ethivia/vacp-runtime';
import {
  defaultVacpDomSnapshotScriptId,
  removeVacpDomSnapshotScript,
  writeVacpDomSnapshotScript,
} from './dom-snapshot';
import { VACP_GLOBAL_KEY } from './window-globals';

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
  void runtime.getCapabilities().catch(() => {});
}

/**
 * Install one runtime per global key, or attach `providers` to the one already installed there. The
 * runtime keeps its identity across reinstalls, and a changed `sessionKey` starts a new history.
 */
export function installVacpRuntime(args: {
  providers: readonly VacpProvider[];
  /** Publish the runtime at `globalKey` on the window. */
  exposeBridge: boolean;
  /** Publish each observation in `application/json` script elements for agents that read the DOM. */
  injectDomSnapshot: boolean;
  globalKey?: string;
  sessionKey?: string;
  runtimeId?: string;
}): { runtime: VacpRuntime; dispose: () => void } {
  const key = args.globalKey || VACP_GLOBAL_KEY;
  const domSnapshotScriptId = defaultVacpDomSnapshotScriptId(key);

  let runtime = runtimes.get(key);
  if (runtime?.signal.aborted) runtime = undefined;
  if (!runtime) {
    runtime = createVacpRuntime({ providers: args.providers, sessionKey: args.sessionKey, runtimeId: args.runtimeId });
  } else if (args.sessionKey && args.sessionKey !== runtime.sessionKey) {
    runtime.update({ providers: args.providers, sessionKey: args.sessionKey });
  }
  const detach = runtime.attachProviders(args.providers);
  runtimes.set(key, runtime);
  if (args.exposeBridge) Object.assign(globalThis, { [key]: runtime });
  else if (Object.getOwnPropertyDescriptor(globalThis, key)?.value === runtime) Reflect.deleteProperty(globalThis, key);
  installDomSnapshotHooks(runtime, { enabled: args.injectDomSnapshot, scriptId: domSnapshotScriptId });

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
  const key = options?.globalKey || VACP_GLOBAL_KEY;
  const runtime = runtimes.get(key);
  if (!runtime) return;
  runtimes.delete(key);
  runtime.dispose();
  if (Object.getOwnPropertyDescriptor(globalThis, key)?.value === runtime) Reflect.deleteProperty(globalThis, key);
}
