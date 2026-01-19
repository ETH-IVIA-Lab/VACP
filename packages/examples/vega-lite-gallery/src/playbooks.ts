import type { VacpPlaybook } from '@vacp/core';

import type { VegaLitePlaybookEntry } from './playbooks/types';

export type { VegaLitePlaybookEntry } from './playbooks/types';

export function buildVegaLitePlaybooks(entry: VegaLitePlaybookEntry): VacpPlaybook[] {
  void entry;
  return [];
}
