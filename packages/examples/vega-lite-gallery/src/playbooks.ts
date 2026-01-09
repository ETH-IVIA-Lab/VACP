import type { VacpPlaybook } from '@vacp/core';

import type { VegaLiteSpecPlaybookContext, VegaLitePlaybookEntry } from './playbooks/types';
import { buildBarsPointSelectPlaybook } from './playbooks/specs/bars-point-select.playbook';
import { buildLinkedBrushDetailPlaybook } from './playbooks/specs/linked-brush-detail.playbook';
import { buildLinkedBrushSummaryPlaybook } from './playbooks/specs/linked-brush-summary.playbook';
import { buildLinkedPointHighlightPlaybook } from './playbooks/specs/linked-point-highlight.playbook';
import { buildScatterParamsPlaybook } from './playbooks/specs/scatter-params.playbook';

export type { VegaLitePlaybookEntry } from './playbooks/types';

function buildPlaybooksForEntry(ctx: VegaLiteSpecPlaybookContext): VacpPlaybook[] {
  switch (ctx.entry.id) {
    case 'bars-point-select':
      return buildBarsPointSelectPlaybook(ctx);
    case 'linked-point-highlight':
      return buildLinkedPointHighlightPlaybook(ctx);
    case 'scatter-params':
      return buildScatterParamsPlaybook(ctx);
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
