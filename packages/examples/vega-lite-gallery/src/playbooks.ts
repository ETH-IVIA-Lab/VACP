import type { VacpPlaybook } from '@vacp/core';

import type { VegaLiteSpecPlaybookContext, VegaLitePlaybookEntry } from './playbooks/types';
import { buildLinkedBrushDetailPlaybook } from './playbooks/specs/linked-brush-detail.playbook';
import { buildLinkedBrushSummaryPlaybook } from './playbooks/specs/linked-brush-summary.playbook';

export type { VegaLitePlaybookEntry } from './playbooks/types';

function buildPlaybooksForEntry(ctx: VegaLiteSpecPlaybookContext): VacpPlaybook[] {
  switch (ctx.entry.id) {
    case 'linked-brush-detail':
      return buildLinkedBrushDetailPlaybook(ctx);
    case 'linked-brush-summary':
      return buildLinkedBrushSummaryPlaybook(ctx);
    default:
      return [];
  }
}

export function buildVegaLitePlaybooks(entry: VegaLitePlaybookEntry): VacpPlaybook[] {
  const viewBase = `vacp://vacp-examples/vega-lite/${entry.id}/${entry.id}`;
  return buildPlaybooksForEntry({ entry, viewBase });
}
