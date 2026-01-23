import type { VacpPlaybook } from '@vacp/core';

import type { VegaLitePlaybookEntry } from './playbooks/types';
import type { VegaLiteSpecPlaybookContext } from './playbooks/types';
import { buildAirportsPlaybooks } from './playbooks/specs/airports.playbook';
import { buildGlobalDevelopmentPlaybooks } from './playbooks/specs/global-development.playbook';
import { buildSeattleWeatherPlaybooks } from './playbooks/specs/seattle-weather.playbook';

export type { VegaLitePlaybookEntry } from './playbooks/types';

export function buildVegaLitePlaybooks(entry: VegaLitePlaybookEntry): VacpPlaybook[] {
  const viewBase = `vacp://vacp-examples/vega-lite/${entry.id}/${entry.id}`;
  const ctx: VegaLiteSpecPlaybookContext = { entry, viewBase };

  switch (entry.id) {
    case '01-global-development':
    case 'global-development':
      return buildGlobalDevelopmentPlaybooks(ctx);
    case '02-seattle-weather':
    case 'seattle-weather':
      return buildSeattleWeatherPlaybooks(ctx);
    case '04-airports':
    case 'airports':
      return buildAirportsPlaybooks(ctx);
    default:
      return [];
  }
}
