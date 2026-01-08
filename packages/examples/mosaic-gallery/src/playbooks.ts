import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';

import type { VgplotPlotLike } from '@vacp/mosaic';

import type { GalleryEntry } from './gallery';

type PlaybookContext = {
  entry: GalleryEntry;
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

function specHasInput(entry: GalleryEntry): boolean {
  return anySpecNode(entry.spec, (n) => typeof n.input === 'string');
}

function roundNum(value: number): number {
  return Number(value.toFixed(6));
}

type DomainValue = number | Date;

function asDomainValue(value: unknown): DomainValue | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return value;
  return null;
}

function domainValueOf(value: DomainValue): number {
  return value instanceof Date ? value.getTime() : value;
}

function normalizeDomain(a: unknown, b: unknown): [DomainValue, DomainValue] | null {
  const x = asDomainValue(a);
  const y = asDomainValue(b);
  if (x === null || y === null) return null;
  return domainValueOf(x) <= domainValueOf(y) ? [x, y] : [y, x];
}

function domainToInterval(domain: [DomainValue, DomainValue], range: [number, number]): [DomainValue, DomainValue] {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const t0 = domainValueOf(d0);
  const t1 = domainValueOf(d1);
  const span = t1 - t0;
  const v0 = t0 + span * r0;
  const v1 = t0 + span * r1;
  if (d0 instanceof Date && d1 instanceof Date) return [new Date(v0), new Date(v1)];
  return [roundNum(v0), roundNum(v1)];
}

function getInterval1dDomain(plot: VgplotPlotLike, interactorId: number): [DomainValue, DomainValue] | null {
  const i = plot.interactors[interactorId] as any;
  const scale = i?.scale;
  if (!scale) return null;
  const raw = typeof scale.domain === 'function' ? scale.domain() : scale.domain;
  if (!Array.isArray(raw) || raw.length < 2) return null;
  return normalizeDomain(raw[0], raw[1]);
}

function getInterval2dDomains(
  plot: VgplotPlotLike,
  interactorId: number,
): { x: [DomainValue, DomainValue]; y: [DomainValue, DomainValue] } | null {
  const i = plot.interactors[interactorId] as any;
  const xscale = i?.xscale;
  const yscale = i?.yscale;
  if (!xscale || !yscale) return null;
  const rawX = typeof xscale.domain === 'function' ? xscale.domain() : xscale.domain;
  const rawY = typeof yscale.domain === 'function' ? yscale.domain() : yscale.domain;
  if (!Array.isArray(rawX) || rawX.length < 2 || !Array.isArray(rawY) || rawY.length < 2) return null;
  const x = normalizeDomain(rawX[0], rawX[1]);
  const y = normalizeDomain(rawY[0], rawY[1]);
  if (!x || !y) return null;
  return { x, y };
}

function menuPlaybook(entry: GalleryEntry, viewBase: string): VacpPlaybook[] {
  return [
    playbook({
      id: `${entry.id}-menu`,
      title: 'Bidirectional filtering (menu)',
      description:
        'Uses a first-class Mosaic input so agent actions and human interactions update the same state graph.',
    })
      .action('Pick a non-default option in the first menu', {
        name: 'mosaic.set_input_option_index',
        params: { ref: `${viewBase}/input/0`, index: 1 },
      })
      .action('Clear the menu filter', { name: 'mosaic.clear_input', params: { ref: `${viewBase}/input/0` } })
      .build(),
  ];
}

function intervalPlaybook(args: {
  entry: GalleryEntry;
  plotId: string;
  interactorId: number;
  kind: '1d' | '2d';
  plot: VgplotPlotLike;
}): VacpPlaybook[] {
  const { entry, plotId, plot, kind } = args;
  const interactorId = String(args.interactorId);
  const base = playbook({
    id: `${entry.id}-selection`,
    title: 'Bidirectional selection',
    description:
      'Runs the same selection operations an agent would, then you can compare with human interaction and time-travel the history.',
  }).action('Clear brush', {
    name: kind === '1d' ? 'mosaic.clear_interval_1d' : 'mosaic.clear_interval_2d',
    params: { plotId, interactorId },
  });

  if (kind === '1d') {
    const domain = getInterval1dDomain(plot, args.interactorId);
    const narrow = domain ? domainToInterval(domain, [0.42, 0.58]) : ([-10, 10] as const);
    const wide = domain ? domainToInterval(domain, [0.2, 0.8]) : ([-25, 70] as const);
    return [
      base
        .action(
          'Set brush (narrow)',
          { name: 'mosaic.set_interval_1d', params: { plotId, interactorId, min: narrow[0], max: narrow[1] } },
          { description: 'Apply a small interval in domain units.' },
        )
        .action(
          'Set brush (wide)',
          { name: 'mosaic.set_interval_1d', params: { plotId, interactorId, min: wide[0], max: wide[1] } },
          { description: 'Move/resize the interval to see linked views update.' },
        )
        .action('Clear brush again', { name: 'mosaic.clear_interval_1d', params: { plotId, interactorId } })
        .build(),
    ];
  }

  const domains = getInterval2dDomains(plot, args.interactorId);
  const x = domains?.x;
  const y = domains?.y;
  const smallBox = domains
    ? {
        x0: domainToInterval(x!, [0.35, 0.55])[0],
        x1: domainToInterval(x!, [0.35, 0.55])[1],
        y0: domainToInterval(y!, [0.35, 0.55])[0],
        y1: domainToInterval(y!, [0.35, 0.55])[1],
      }
    : { x0: 30, x1: 60, y0: 30, y1: 60 };
  const otherBox = domains
    ? {
        x0: domainToInterval(x!, [0.1, 0.3])[0],
        x1: domainToInterval(x!, [0.1, 0.3])[1],
        y0: domainToInterval(y!, [0.6, 0.85])[0],
        y1: domainToInterval(y!, [0.6, 0.85])[1],
      }
    : { x0: 10, x1: 40, y0: 50, y1: 90 };

  return [
    base
      .action(
        'Set brush (small box)',
        { name: 'mosaic.set_interval_2d', params: { plotId, interactorId, ...smallBox } },
        { description: 'Apply a small x/y box in domain units.' },
      )
      .action('Set brush (different box)', {
        name: 'mosaic.set_interval_2d',
        params: { plotId, interactorId, ...otherBox },
      })
      .action('Clear brush again', { name: 'mosaic.clear_interval_2d', params: { plotId, interactorId } })
      .build(),
  ];
}

const perSpec: Record<string, PlaybookBuilder> = {
  'wnba-shots': ({ viewBase }) => [
    playbook({
      id: `wnba-shots-menus`,
      title: 'Bidirectional filtering',
      description:
        'Uses the same semantic menu operations an agent can call. Then compare with manual menu interaction and time travel the history.',
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
    const intervalPlot = plots.find((p) => p.plot.interactors.some((i) => i.constructor?.name === 'Interval1D'));
    const intervalId = intervalPlot
      ? intervalPlot.plot.interactors.findIndex((i) => i.constructor?.name === 'Interval1D')
      : -1;

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

      // Many `dateMonthDay` scales expose "day-of-year like" units (0..365).
      if (n0 >= 0 && n1 <= 400) return { min: Math.max(n0, 60), max: Math.min(n1, 151) };
      // Fallback: select roughly "spring" (Mar→May ≈ 2/12→5/12).
      return { min: roundNum(n0 + (n1 - n0) * (2 / 12)), max: roundNum(n0 + (n1 - n0) * (5 / 12)) };
    })();

    const legendPlot = plots.find((p) =>
      ((p.plot as any).legends ?? []).some((raw: any) => {
        const legend = raw && typeof raw === 'object' && 'legend' in raw ? raw.legend : raw;
        return !!legend?.selection;
      }),
    );

    return [
      playbook({
        id: `weather-linked`,
        title: 'Brush (Mar→May) + legend click (fog)',
        description:
          'Clear selection, brush March→May on the top plot, then select “fog” (equivalent to clicking the legend).',
      })
        .action('Clear brush', {
          name: 'mosaic.clear_interval_1d',
          params: { plotId: intervalPlot?.plotId ?? 'plot-0', interactorId: String(Math.max(0, intervalId)) },
        })
        .action('Clear legend selection', {
          name: 'mosaic.clear_legend_toggle',
          params: { plotId: legendPlot?.plotId ?? 'plot-0', channel: 'color' },
        })
        .action('Brush March→May', {
          name: 'mosaic.set_interval_1d',
          params: {
            plotId: intervalPlot?.plotId ?? 'plot-0',
            interactorId: String(Math.max(0, intervalId)),
            min: marchToMay.min,
            max: marchToMay.max,
          },
        })
        .action('Click “fog” on legend', {
          name: 'mosaic.set_legend_toggle',
          params: { plotId: legendPlot?.plotId ?? 'plot-0', channel: 'color', value: 'fog' },
        })
        .build(),
    ];
  },
};

function resolveSelectionPlaybook(args: {
  entry: GalleryEntry;
  plots: Array<{ plotId: string; plot: VgplotPlotLike }>;
}): VacpPlaybook[] {
  const interval2d = args.plots.find((p) => p.plot.interactors.some((i) => i.constructor?.name === 'Interval2D'));
  if (interval2d) {
    const interactorId = interval2d.plot.interactors.findIndex((i) => i.constructor?.name === 'Interval2D');
    if (interactorId >= 0) {
      return intervalPlaybook({
        entry: args.entry,
        kind: '2d',
        plotId: interval2d.plotId,
        interactorId,
        plot: interval2d.plot,
      });
    }
  }

  const interval1d = args.plots.find((p) => p.plot.interactors.some((i) => i.constructor?.name === 'Interval1D'));
  if (interval1d) {
    const interactorId = interval1d.plot.interactors.findIndex((i) => i.constructor?.name === 'Interval1D');
    if (interactorId >= 0) {
      return intervalPlaybook({
        entry: args.entry,
        kind: '1d',
        plotId: interval1d.plotId,
        interactorId,
        plot: interval1d.plot,
      });
    }
  }

  return [];
}

export function buildPlaybooks(args: {
  entry: GalleryEntry;
  plots: Array<{ plotId: string; plot: VgplotPlotLike }>;
}): VacpPlaybook[] {
  const viewBase = `vacp://vacp-examples/mosaic/${args.entry.id}`;
  const entry = args.entry;
  const specific = perSpec[entry.id];
  if (specific) return specific({ entry, viewBase, plots: args.plots });

  const playbooks: VacpPlaybook[] = [];
  if (specHasInput(entry)) playbooks.push(...menuPlaybook(entry, viewBase));
  playbooks.push(...resolveSelectionPlaybook({ entry, plots: args.plots }));
  if (playbooks.length) return playbooks;

  return [
    playbook({
      id: `${entry.id}-empty`,
      title: 'No scripted playbook',
      description:
        'This spec does not expose a stable, semantic control for a generic playbook. Use the Actions module to dispatch provider actions directly.',
    }).build(),
  ];
}
