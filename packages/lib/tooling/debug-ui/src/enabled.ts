import { getVacpHyperParams } from '@vacp/core';
import type { VacpDebugUiEnabled } from './types';

export function shouldEnable(enabled: VacpDebugUiEnabled | undefined): boolean {
  if (enabled === true) return true;
  if (enabled === false) return false;
  return getVacpHyperParams().debugUi;
}
