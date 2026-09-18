import { getVacpBrowserOptions } from '@vacp/runtime-browser';
import type { VacpInspectorEnabled } from './types';

export function shouldEnable(enabled: VacpInspectorEnabled | undefined): boolean {
  if (enabled === true) return true;

  if (enabled === false) return false;

  return getVacpBrowserOptions().inspector;
}
