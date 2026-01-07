import type { VacpDebugUiEnabled } from './types';

export function shouldEnable(enabled: VacpDebugUiEnabled | undefined): boolean {
  if (enabled === true) return true;
  if (enabled === false) return false;
  const url = new URL(window.location.href);
  if (url.searchParams.get('vacpDebug') === '1') return true;
  try {
    if (localStorage.getItem('vacp:debug') === '1') return true;
  } catch {
    // ignore
  }
  return false;
}
