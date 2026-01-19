import { getVacpHyperParams } from '@vacp/core';

export type VacpEnabled = boolean | 'auto';
export type VacpDebugUIEnabled = VacpEnabled;

export const VACP_DEFAULT_GLOBAL_KEY = '__vacp';

export function shouldEnableDebugUI(enabled: VacpDebugUIEnabled = 'auto'): boolean {
  if (enabled === true) return true;
  if (enabled === false) return false;
  return getVacpHyperParams().debugUi;
}

export async function installVacpDebugUI(args?: {
  enabled?: VacpDebugUIEnabled;
  globalKey?: string;
  includeActions?: boolean;
}): Promise<void> {
  const enabled = args?.enabled ?? 'auto';
  if (!shouldEnableDebugUI(enabled)) return;

  const globalKey = args?.globalKey ?? VACP_DEFAULT_GLOBAL_KEY;
  const includeActions = args?.includeActions;

  try {
    const { installVacpDebugUi } = await import('@vacp/debug-ui');
    installVacpDebugUi({ enabled: true, globalKey, ...(includeActions === undefined ? {} : { includeActions }) });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`Failed to install @vacp/debug-ui: ${String(err)}`);
  }
}
