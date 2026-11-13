import type { VacpRef } from '@ethivia/vacp-sdk';

export function makeRef({
  appId,
  viewId,
  vizId,
  suffix,
}: {
  appId: string;
  viewId: string;
  vizId: string;
  suffix: string;
}): VacpRef {
  return `vacp://${appId}/${viewId}/${vizId}${suffix}`;
}
