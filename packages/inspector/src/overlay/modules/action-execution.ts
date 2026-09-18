import type { VacpActionCall, VacpActionResult, VacpChangeSource } from '@vacp/protocol';

import type { VacpRuntimeBridge } from '@vacp/protocol';

type InspectorActionOptions = {
  source?: VacpChangeSource;
  message?: string;
};

export async function executeInspectorAction(
  bridge: VacpRuntimeBridge,
  call: VacpActionCall,
  options: InspectorActionOptions = { source: 'inspector' },
): Promise<VacpActionResult> {
  if (typeof bridge.dispatch === 'function') return bridge.dispatch(call, options);

  return bridge.execute(call);
}
