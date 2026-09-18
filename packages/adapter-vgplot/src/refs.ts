import type { VacpRef } from '@vacp/protocol';

export function makePlotRef(args: { appId: string; viewId: string; plotId: string; suffix: string }): VacpRef {
  return `vacp://${args.appId}/${args.viewId}/${args.plotId}${args.suffix}`;
}

export function makeViewRef(args: { appId: string; viewId: string; suffix: string }): VacpRef {
  return `vacp://${args.appId}/${args.viewId}${args.suffix}`;
}
