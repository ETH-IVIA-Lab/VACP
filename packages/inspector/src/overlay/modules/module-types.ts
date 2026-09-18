import type { VacpRuntimeSnapshot } from '@vacp/protocol';

import type { VacpRuntimeBridge } from '@vacp/protocol';

export type VacpInspectorModuleProps = {
  bridge: VacpRuntimeBridge;
  runtime: VacpRuntimeSnapshot;
};
