import type { VacpPlaybook } from '@vacp/core';
import type { VgplotPlotLike, VgplotTableLike } from '@vacp/vgplot';

import type { MosaicPlaybookEntry, MosaicSpecPlaybookContext } from './playbooks/types';
import { buildAthletesPlaybook } from './playbooks/specs/athletes.playbook';
import { buildCrossfilterPlaybook } from './playbooks/specs/crossfilter.playbook';
import { buildFlightsHexbinPlaybook } from './playbooks/specs/flights-hexbin.playbook';
import { buildLineMultiSeriesPlaybook } from './playbooks/specs/line-multi-series.playbook';
import { buildNormalizeStocksPlaybook } from './playbooks/specs/normalize.playbook';
import { buildNycTaxiRidesPlaybook } from './playbooks/specs/nyc-taxi-rides.playbook';
import { buildPanZoomPlaybook } from './playbooks/specs/pan-zoom.playbook';
import { buildUsStateMapPlaybook } from './playbooks/specs/us-state-map.playbook';
import { buildWeatherPlaybook } from './playbooks/specs/weather.playbook';
import { buildWnbaShotsPlaybook } from './playbooks/specs/wnba-shots.playbook';

export type { MosaicPlaybookEntry } from './playbooks/types';

function buildPlaybooksForEntry(ctx: MosaicSpecPlaybookContext): VacpPlaybook[] {
  switch (ctx.entry.id) {
    case 'athletes':
      return buildAthletesPlaybook(ctx);
    case 'crossfilter':
      return buildCrossfilterPlaybook(ctx);
    case 'flights-hexbin':
      return buildFlightsHexbinPlaybook(ctx);
    case 'line-multi-series':
      return buildLineMultiSeriesPlaybook(ctx);
    case 'normalize':
      return buildNormalizeStocksPlaybook(ctx);
    case 'nyc-taxi-rides':
      return buildNycTaxiRidesPlaybook(ctx);
    case 'pan-zoom':
      return buildPanZoomPlaybook(ctx);
    case 'us-state-map':
      return buildUsStateMapPlaybook(ctx);
    case 'weather':
      return buildWeatherPlaybook(ctx);
    case 'wnba-shots':
      return buildWnbaShotsPlaybook(ctx);
    default:
      return [];
  }
}

export function buildMosaicPlaybooks(args: {
  entry: MosaicPlaybookEntry;
  root: ParentNode;
  plots: Array<{ plotId: string; plot: VgplotPlotLike }>;
  tables?: Array<{ tableId: string; table: VgplotTableLike }>;
}): VacpPlaybook[] {
  const viewBase = `vacp://vacp-examples/mosaic/${args.entry.id}`;
  const tables = args.tables ?? [];
  return buildPlaybooksForEntry({ entry: args.entry, viewBase, plots: args.plots, tables });
}
