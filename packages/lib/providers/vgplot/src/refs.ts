import type { VacpRef } from '@vacp/core';

export function makePlotRef(args: { appId: string; viewId: string; plotId: string; suffix: string }): VacpRef {
  return `vacp://${args.appId}/${args.viewId}/${args.plotId}${args.suffix}` as VacpRef;
}

export function makeViewRef(args: { appId: string; viewId: string; suffix: string }): VacpRef {
  return `vacp://${args.appId}/${args.viewId}${args.suffix}` as VacpRef;
}
