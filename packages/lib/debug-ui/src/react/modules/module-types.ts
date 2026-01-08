import type { VacpPlaybook, VacpRuntimeSnapshot } from '@vacp/core';

import type { VacpWindowBridge } from '../../types';

export type VacpDebugModuleProps = {
  bridge: VacpWindowBridge;
  runtime: VacpRuntimeSnapshot;
  playbooks: VacpPlaybook[];
};

