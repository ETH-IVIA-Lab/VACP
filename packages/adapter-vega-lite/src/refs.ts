import type { VacpRef } from '@vacp/protocol';

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
