import type { VacpActionCall, VacpActionResult, VacpChangeSource } from '@vacp/core';

import type { VacpWindowBridge } from '@vacp/debug-ui/types';

type DebugActionOptions = {
  source?: VacpChangeSource;
  message?: string;
};

export async function executeDebugAction(
  bridge: VacpWindowBridge,
  call: VacpActionCall,
  options: DebugActionOptions = { source: 'debug' },
): Promise<VacpActionResult> {
  if (typeof bridge.dispatch === 'function') return bridge.dispatch(call, options);
  return bridge.execute(call);
}
