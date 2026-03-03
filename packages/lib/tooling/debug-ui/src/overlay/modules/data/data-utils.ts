import type { VacpRef } from '@vacp/core';

export function defaultQuery(): string {
  return [
    'SELECT',
    '  COUNT(*)::INTEGER AS n_selected,',
    '  (SELECT COUNT(*)::INTEGER FROM vacp_all) AS n_all',
    'FROM vacp_handle;',
  ].join('\n');
}

export function shortRef(ref: VacpRef): string {
  const s = String(ref);
  const hashIdx = s.indexOf('#');
  const clean = hashIdx >= 0 ? s.slice(0, hashIdx) : s;
  const parts = clean
    .split('/')
    .filter(Boolean)
    .filter((p) => p !== 'vacp:');
  return parts.slice(-3).join('/');
}
