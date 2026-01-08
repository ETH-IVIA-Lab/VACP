import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';
import type { VgplotPlotLike } from '@vacp/mosaic';

import { getInterval1dDomain, roundNum, type DomainValue } from './domains';
import { resolveInteractorPlaybooks } from './interactor-playbooks';

export type MosaicPlaybookEntry = {
  id: string;
  meta: { title: string; description?: string };
  spec: unknown;
};

type PlaybookContext = {
  entry: MosaicPlaybookEntry;
  viewBase: string;
  plots: Array<{ plotId: string; plot: VgplotPlotLike }>;
};

type PlaybookBuilder = (ctx: PlaybookContext) => VacpPlaybook[];

function anySpecNode(obj: unknown, pred: (node: Record<string, unknown>) => boolean): boolean {
  if (!obj || typeof obj !== 'object') return false;
  if (Array.isArray(obj)) return obj.some((v) => anySpecNode(v, pred));
  const rec = obj as Record<string, unknown>;
  if (pred(rec)) return true;
  return Object.values(rec).some((v) => anySpecNode(v, pred));
}

function specHasInput(entry: MosaicPlaybookEntry): boolean {
  return anySpecNode(entry.spec, (n) => typeof n.input === 'string');
}

function menuPlaybook(entry: MosaicPlaybookEntry, viewBase: string): VacpPlaybook[] {
  return [
    playbook({
      id: `${entry.id}-menu`,
      title: 'Bidirectional filtering (menu)',
      description: 'Use Mosaic inputs as semantic actions (agent-like) and compare with manual interaction.',
    })
      .action('Pick a non-default option in the first menu', {
        name: 'mosaic.set_input_option_index',
        params: { ref: `${viewBase}/input/0`, index: 1 },
      })
      .action('Clear the menu filter', { name: 'mosaic.clear_input', params: { ref: `${viewBase}/input/0` } })
      .build(),
  ];
}

const perSpec: Record<string, PlaybookBuilder> = {
  'wnba-shots': ({ viewBase }) => [
    playbook({
      id: `wnba-shots-menus`,
      title: 'Bidirectional filtering',
      description: 'Filter by team and athlete (agent-like) and compare with manual menu interaction.',
    })
      .action('Pick a team (first non-All option)', {
        name: 'mosaic.set_input_option_index',
        params: { ref: `${viewBase}/input/0`, index: 1 },
      })
      .action(
        'Pick an athlete (first non-All option)',
        { name: 'mosaic.set_input_option_index', params: { ref: `${viewBase}/input/1`, index: 1 } },
        { description: 'The Athlete menu is filtered by the selected team.' },
      )
      .action('Clear athlete filter', { name: 'mosaic.clear_input', params: { ref: `${viewBase}/input/1` } })
      .action('Clear team filter', { name: 'mosaic.clear_input', params: { ref: `${viewBase}/input/0` } })
      .build(),
  ],
  weather: ({ plots }) => {
    const domainValueOf = (value: DomainValue) => (value instanceof Date ? value.getTime() : value);
    const intervalPlot = plots.find((p) => p.plot.interactors.some((i) => i.constructor?.name === 'Interval1D'));
    const intervalId = intervalPlot ? intervalPlot.plot.interactors.findIndex((i) => i.constructor?.name === 'Interval1D') : -1;

    const marchToMay = (() => {
      const domain = intervalPlot && intervalId >= 0 ? getInterval1dDomain(intervalPlot.plot, intervalId) : null;
      if (domain && domain[0] instanceof Date && domain[1] instanceof Date) {
        const year = domain[0].getFullYear();
        const start = new Date(year, 2, 1);
        const end = new Date(year, 4, 31, 23, 59, 59, 999);
        const lo = Math.max(domain[0].getTime(), start.getTime());
        const hi = Math.min(domain[1].getTime(), end.getTime());
        return { min: new Date(lo), max: new Date(hi) };
      }

      const [d0, d1] = domain ?? ([0, 365] as const);
      const n0 = domainValueOf(d0 as DomainValue);
      const n1 = domainValueOf(d1 as DomainValue);

      if (n0 >= 0 && n1 <= 400) return { min: Math.max(n0, 60), max: Math.min(n1, 151) };
      return { min: roundNum(n0 + (n1 - n0) * (2 / 12)), max: roundNum(n0 + (n1 - n0) * (5 / 12)) };
    })();

    return [
      playbook({
        id: `weather-linked`,
        title: 'Brush (Mar→May) + legend click (fog + snow)',
        description:
          'Clear selection, brush March→May on the top plot, then select “fog” and add “snow” (equivalent to multi-selecting legend items).',
      })
        .action('Clear brush', {
          name: 'mosaic.clear_interval_1d',
          params: { plotId: intervalPlot?.plotId ?? 'plot-0', interactorId: String(Math.max(0, intervalId)) },
        })
        .action('Clear legend selection', { name: 'mosaic.clear_legend_toggle', params: { plotId: 'plot-0', channel: 'color' } })
        .action('Brush March→May', {
          name: 'mosaic.set_interval_1d',
          params: {
            plotId: intervalPlot?.plotId ?? 'plot-0',
            interactorId: String(Math.max(0, intervalId)),
            min: marchToMay.min,
            max: marchToMay.max,
          },
        })
        .action('Click “fog” on legend', { name: 'mosaic.set_legend_toggle', params: { plotId: 'plot-0', channel: 'color', value: 'fog' } })
        .action('Add “snow” (fog + snow)', {
          name: 'mosaic.set_legend_toggle',
          params: { plotId: 'plot-0', channel: 'color', value: ['fog', 'snow'] },
        })
        .build(),
    ];
  },
};

export function buildMosaicPlaybooks(args: { entry: MosaicPlaybookEntry; plots: Array<{ plotId: string; plot: VgplotPlotLike }> }): VacpPlaybook[] {
  const viewBase = `vacp://vacp-examples/mosaic/${args.entry.id}`;
  const entry = args.entry;

  const specific = perSpec[entry.id];
  if (specific) return specific({ entry, viewBase, plots: args.plots });

  const playbooks: VacpPlaybook[] = [];
  if (specHasInput(entry)) playbooks.push(...menuPlaybook(entry, viewBase));
  playbooks.push(...resolveInteractorPlaybooks({ entry, plots: args.plots }));
  return playbooks;
}
