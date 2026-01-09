import type { VacpPlaybook } from '@vacp/core';
import { playbook } from '@vacp/kit';
import type { VgplotPlotLike } from '@vacp/vgplot';

import {
  domainToInterval,
  getInterval1dDomain,
  getInterval2dDomains,
  getPanZoom2dDomains,
} from './domains';
import type { MosaicPlaybookEntry } from './types';

type PlotRef = { plotId: string; plot: VgplotPlotLike };

function intervalPlaybook(args: {
  entry: MosaicPlaybookEntry;
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
    description: 'Apply selections via actions, then compare with manual brushing and time-travel the history.',
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
        .action('Set brush (narrow)', {
          name: 'mosaic.set_interval_1d',
          params: { plotId, interactorId, min: narrow[0], max: narrow[1] },
        })
        .action('Set brush (wider)', {
          name: 'mosaic.set_interval_1d',
          params: { plotId, interactorId, min: wide[0], max: wide[1] },
        })
        .action('Clear brush again', { name: 'mosaic.clear_interval_1d', params: { plotId, interactorId } })
        .build(),
    ];
  }

  const domains = getInterval2dDomains(plot, args.interactorId);
  const x = domains ? domainToInterval(domains.x, [0.25, 0.55]) : ([0, 1] as const);
  const y = domains ? domainToInterval(domains.y, [0.25, 0.55]) : ([0, 1] as const);

  return [
    base
      .action('Set brush (corner)', {
        name: 'mosaic.set_interval_2d',
        params: { plotId, interactorId, x0: x[0], x1: x[1], y0: y[0], y1: y[1] },
      })
      .action('Clear brush again', { name: 'mosaic.clear_interval_2d', params: { plotId, interactorId } })
      .build(),
  ];
}

function panZoomPlaybook(entry: MosaicPlaybookEntry, plotId: string, plot: VgplotPlotLike, interactorIdNum: number): VacpPlaybook[] {
  const interactorId = String(interactorIdNum);
  const domains = getPanZoom2dDomains(plot, interactorIdNum);
  const x = domains?.x ? domainToInterval(domains.x, [0.2, 0.8]) : null;
  const y = domains?.y ? domainToInterval(domains.y, [0.2, 0.8]) : null;

  return [
    playbook({
      id: `${entry.id}-pan-zoom`,
      title: 'Pan + zoom',
      description: 'Change view domains programmatically, then clear.',
    })
      .action('Clear pan/zoom', { name: 'mosaic.clear_pan_zoom', params: { plotId, interactorId } })
      .action('Set pan/zoom domain', {
        name: 'mosaic.set_pan_zoom',
        params: { plotId, interactorId, x0: x?.[0] ?? null, x1: x?.[1] ?? null, y0: y?.[0] ?? null, y1: y?.[1] ?? null },
      })
      .action('Clear pan/zoom again', { name: 'mosaic.clear_pan_zoom', params: { plotId, interactorId } })
      .build(),
  ];
}

function guessToggleValue(plot: VgplotPlotLike, interactorIdNum: number): unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const i = plot.interactors[interactorIdNum] as any;
  const sel = i?.selection?.value;
  if (sel !== undefined) return sel;
  const v = i?.value;
  if (v !== undefined) return v;
  return 1;
}

function toggleLikePlaybook(args: {
  entry: MosaicPlaybookEntry;
  kind: 'toggle' | 'nearest' | 'region';
  plotId: string;
  plot: VgplotPlotLike;
  interactorIdNum: number;
}): VacpPlaybook[] {
  const baseName = args.kind === 'nearest' ? 'Nearest' : args.kind === 'region' ? 'Region' : 'Toggle';
  const interactorId = String(args.interactorIdNum);
  const setName =
    args.kind === 'nearest' ? 'mosaic.set_nearest' : args.kind === 'region' ? 'mosaic.set_region' : 'mosaic.set_toggle';
  const clearName =
    args.kind === 'nearest' ? 'mosaic.clear_nearest' : args.kind === 'region' ? 'mosaic.clear_region' : 'mosaic.clear_toggle';

  const guess = guessToggleValue(args.plot, args.interactorIdNum);
  const actionValue = args.kind === 'nearest' ? [guess] : guess;

  return [
    playbook({
      id: `${args.entry.id}-${args.kind}`,
      title: `${baseName} selection`,
      description: `Drive a ${baseName.toLowerCase()} selection via actions (best-effort).`,
    })
      .action(`Clear ${baseName.toLowerCase()}`, { name: clearName, params: { plotId: args.plotId, interactorId } })
      .action(`Set ${baseName.toLowerCase()} value`, { name: setName, params: { plotId: args.plotId, interactorId, value: actionValue } })
      .action(`Clear ${baseName.toLowerCase()} again`, { name: clearName, params: { plotId: args.plotId, interactorId } })
      .build(),
  ];
}

function legendTogglePlaybook(entry: MosaicPlaybookEntry, plotId: string, plot: VgplotPlotLike): VacpPlaybook[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (plot as any).legends;
  const legends = Array.isArray(raw)
    ? raw.map((x) => (x && typeof x === 'object' && 'legend' in x ? (x as any).legend : x)).filter(Boolean)
    : [];
  const interactive = legends.filter((l: any) => !!l?.selection);
  const match = interactive[0];
  if (!match) return [];

  const channel = typeof match.channel === 'string' && match.channel ? match.channel : 'color';
  const scale = match.scale;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyScale = scale as any;
  const domain = typeof anyScale?.domain === 'function' ? anyScale.domain() : anyScale?.domain;
  const first = Array.isArray(domain) && domain.length > 0 ? domain[0] : (match.values?.[0] ?? match.entries?.[0]?.value ?? 0);

  return [
    playbook({
      id: `${entry.id}-legend`,
      title: 'Legend selection',
      description: 'Select a category via the interactive legend, then clear.',
    })
      .action('Clear legend selection', { name: 'mosaic.clear_legend_toggle', params: { plotId, channel } })
      .action('Select first legend item', { name: 'mosaic.set_legend_toggle', params: { plotId, channel, value: first } })
      .action('Clear legend again', { name: 'mosaic.clear_legend_toggle', params: { plotId, channel } })
      .build(),
  ];
}

export function resolveInteractorPlaybooks(args: { entry: MosaicPlaybookEntry; plots: PlotRef[] }): VacpPlaybook[] {
  const out: VacpPlaybook[] = [];

  const interval2d = args.plots.find((p) => p.plot.interactors.some((i) => i.constructor?.name === 'Interval2D'));
  if (interval2d) {
    const interactorId = interval2d.plot.interactors.findIndex((i) => i.constructor?.name === 'Interval2D');
    if (interactorId >= 0)
      out.push(
        ...intervalPlaybook({
          entry: args.entry,
          kind: '2d',
          plotId: interval2d.plotId,
          interactorId,
          plot: interval2d.plot,
        }),
      );
  }

  if (out.length === 0) {
    const interval1d = args.plots.find((p) => p.plot.interactors.some((i) => i.constructor?.name === 'Interval1D'));
    if (interval1d) {
      const interactorId = interval1d.plot.interactors.findIndex((i) => i.constructor?.name === 'Interval1D');
      if (interactorId >= 0)
        out.push(
          ...intervalPlaybook({
            entry: args.entry,
            kind: '1d',
            plotId: interval1d.plotId,
            interactorId,
            plot: interval1d.plot,
          }),
        );
    }
  }

  const panzoom = args.plots.find((p) => p.plot.interactors.some((i) => i.constructor?.name === 'PanZoom'));
  if (panzoom) {
    const interactorId = panzoom.plot.interactors.findIndex((i) => i.constructor?.name === 'PanZoom');
    if (interactorId >= 0) out.push(...panZoomPlaybook(args.entry, panzoom.plotId, panzoom.plot, interactorId));
  }

  const region = args.plots.find((p) => p.plot.interactors.some((i) => i.constructor?.name === 'Region'));
  if (region) {
    const interactorId = region.plot.interactors.findIndex((i) => i.constructor?.name === 'Region');
    if (interactorId >= 0)
      out.push(
        ...toggleLikePlaybook({
          entry: args.entry,
          kind: 'region',
          plotId: region.plotId,
          plot: region.plot,
          interactorIdNum: interactorId,
        }),
      );
  }

  const nearest = args.plots.find((p) => p.plot.interactors.some((i) => i.constructor?.name === 'Nearest'));
  if (nearest) {
    const interactorId = nearest.plot.interactors.findIndex((i) => i.constructor?.name === 'Nearest');
    if (interactorId >= 0)
      out.push(
        ...toggleLikePlaybook({
          entry: args.entry,
          kind: 'nearest',
          plotId: nearest.plotId,
          plot: nearest.plot,
          interactorIdNum: interactorId,
        }),
      );
  }

  const toggle = args.plots.find((p) => p.plot.interactors.some((i) => i.constructor?.name === 'Toggle'));
  if (toggle) {
    const interactorId = toggle.plot.interactors.findIndex((i) => i.constructor?.name === 'Toggle');
    if (interactorId >= 0)
      out.push(
        ...toggleLikePlaybook({
          entry: args.entry,
          kind: 'toggle',
          plotId: toggle.plotId,
          plot: toggle.plot,
          interactorIdNum: interactorId,
        }),
      );
  }

  const legend = args.plots.find((p) =>
    (p.plot.legends ?? []).some((raw) => {
      const l = raw && typeof raw === 'object' && 'legend' in raw ? (raw as any).legend : (raw as any);
      return !!l?.selection;
    }),
  );
  if (legend) out.push(...legendTogglePlaybook(args.entry, legend.plotId, legend.plot));

  return out;
}
