import type { VacpChangeSource, VacpProvider } from '@vacp/protocol';
import { type VacpRuntime } from '@vacp/runtime';
import { installVacpRuntime } from '@vacp/runtime-browser';

export { createVacpProvider, type VacpAnalyticalProjection } from '@vacp/runtime';

export type VacpIntegration = {
  bridge: VacpRuntime;
  providers: readonly VacpProvider[];
  dispose: () => void;
  refresh: (source: VacpChangeSource, message: string) => void;
};

/** Install or replace the composed source set for one browser runtime. */
export function installVacp(args: {
  globalKey?: string;
  providers: readonly VacpProvider[];
  sessionKey?: string;
  exposeBridge?: boolean;
  injectDomSnapshot?: boolean;
  domSnapshotScriptId?: string;
}): VacpIntegration {
  const globalKey = args.globalKey ?? '__vacp';
  const installation = installVacpRuntime({
    providers: args.providers,
    sessionKey: args.sessionKey,
    globalKey,
    exposeBridge: args.exposeBridge,
    injectDomSnapshot: args.injectDomSnapshot,
    domSnapshotScriptId: args.domSnapshotScriptId,
  });
  const bridge = installation.runtime;
  const refresh = (source: VacpChangeSource, message: string) => {
    void bridge.refresh({ source, message }).catch(() => {});
  };
  return {
    bridge,
    providers: args.providers,
    refresh,
    dispose: installation.dispose,
  };
}
