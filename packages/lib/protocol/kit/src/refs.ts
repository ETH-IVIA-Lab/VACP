import type { VacpRef } from '@vacp/core';

export type VacpRefBuilder = {
  /** Root reference (`vacp://app/view` or `vacp://app/view/viz`). */
  root: VacpRef;
  /** Create a stable child ref by appending a suffix path. */
  ref: (suffix?: string) => VacpRef;
};

function joinRef(root: string, suffix: string): string {
  if (!suffix) return root;
  if (suffix === '/') return root;
  if (suffix.startsWith('/')) return `${root}${suffix}`;
  return `${root}/${suffix}`;
}

/**
 * Create a stable `vacp://...` ref namespace for a view (and optional viz id).
 *
 * Example:
 * - `root`: `vacp://myapp/myview/scatter`
 * - `ref('/selection/points')`: `vacp://myapp/myview/scatter/selection/points`
 */
export function createVacpRefBuilder(args: { appId: string; viewId: string; vizId?: string }): VacpRefBuilder {
  const parts = [args.appId, args.viewId, args.vizId].filter(Boolean) as string[];
  const root = `vacp://${parts.join('/')}` as VacpRef;
  return { root, ref: (suffix) => joinRef(root, suffix ?? '') as VacpRef };
}
