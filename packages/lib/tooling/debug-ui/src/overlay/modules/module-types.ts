import type { VacpRuntimeSnapshot } from '@vacp/core';

import type { VacpWindowBridge } from '@vacp/debug-ui/types';

export type VacpDebugModuleProps = {
  bridge: VacpWindowBridge;
  runtime: VacpRuntimeSnapshot;
};
