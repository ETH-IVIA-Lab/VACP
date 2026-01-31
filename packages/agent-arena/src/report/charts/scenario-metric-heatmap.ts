import * as Plot from '@observablehq/plot';
import { plotSvg } from './plot.js';
import {
  bucketIndex,
  isDark,
  marginLeftForLabels,
  meanNumber,
  medianNumber,
  quantiles,
  resolveLayout,
  tickStep,
} from './utils.js';
import type { ArenaChart, ArenaChartContext, ArenaFigureLayout, ArenaReportTheme } from './types.js';
import type { NormalizedRun } from '../stats.js';

export type ScenarioMetricHeatmapSpec = {
  id: string;
  title: string;
  caption: string;
  valueLabel: string;
  getValue: (run: NormalizedRun) => number | null;
  formatCell: (value: number) => string;
  formatTitle: (value: number) => string;
  aggregate: 'median' | 'mean';
  palette?: string[];
};

export type ScenarioMetricHeatmapConfig = ArenaFigureLayout;

export function createScenarioMetricHeatmapChart(
  spec: ScenarioMetricHeatmapSpec,
): ArenaChart<ScenarioMetricHeatmapConfig> {
  return {
    id: spec.id,
    title: spec.title,
    caption: spec.caption,
    isApplicable: (ctx) => ctx.runs.some((r) => typeof spec.getValue(r) === 'number'),
    render: (ctx, config) => renderScenarioMetricHeatmap({ ctx, config, spec }),
  };
}

function renderScenarioMetricHeatmap(args: {
  ctx: ArenaChartContext;
  config?: ScenarioMetricHeatmapConfig;
  spec: ScenarioMetricHeatmapSpec;
}) {
  const palette = args.spec.palette ?? ['#eff6ff', '#bfdbfe', '#93c5fd', '#60a5fa', '#2563eb', '#1e3a8a'];

  const scenarioIndex = new Map<string, number>();
  for (const [i, id] of args.ctx.scenarioDomain.entries()) scenarioIndex.set(id, i + 1);

  const labelEvery = tickStep(args.ctx.scenarioDomain.length);

  const totalByKey = new Map<string, number>();
  const valuesByKey = new Map<string, number[]>();
  for (const r of args.ctx.runs) {
    if (!r.experiment || !r.scenarioId) continue;
    const key = `${r.experiment}__${r.scenarioId}`;
    totalByKey.set(key, (totalByKey.get(key) ?? 0) + 1);

    const v = args.spec.getValue(r);
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const list = valuesByKey.get(key) ?? [];
    list.push(v);
    valuesByKey.set(key, list);
  }

  const aggregates = new Map<string, { value: number; n: number }>();
  for (const [key, values] of valuesByKey) {
    const value = args.spec.aggregate === 'mean' ? meanNumber(values) : medianNumber(values);
    aggregates.set(key, { value, n: values.length });
  }

  const allValues = Array.from(aggregates.values()).map((d) => d.value);
  const q = quantiles(allValues, [0.2, 0.4, 0.6, 0.8]);

  const cells = [];
  for (const experiment of args.ctx.experimentDomain) {
    for (const scenarioId of args.ctx.scenarioDomain) {
      const key = `${experiment}__${scenarioId}`;
      const total = totalByKey.get(key) ?? 0;
      const agg = aggregates.get(key) ?? null;
      const value = agg ? agg.value : null;
      const n = agg ? agg.n : 0;

      const fill =
        total === 0 ? '#ffffff' : value === null ? args.ctx.theme.colors.grid : palette[bucketIndex(value, q)];

      const label = total === 0 ? '' : value === null ? 'n/a' : args.spec.formatCell(value);
      const textFill = isDark(fill) ? '#ffffff' : args.ctx.theme.colors.ink;

      cells.push({
        experiment,
        scenarioId,
        total,
        n,
        value,
        fill,
        label,
        textFill,
      });
    }
  }

  const layout = resolveLayout(
    args.ctx.theme,
    {
      height: Math.max(220, 36 + args.ctx.experimentDomain.length * 26),
      marginLeft: marginLeftForLabels(args.ctx.experimentDomain, args.ctx.theme, { min: 140, max: 320 }),
      marginRight: 24,
      marginTop: 16,
      marginBottom: 56,
    },
    args.config,
  );

  const svg = plotSvg({
    theme: args.ctx.theme,
    plot: Plot.plot({
      document: args.ctx.document,
      width: layout.width,
      height: layout.height,
      marginLeft: layout.marginLeft,
      marginRight: layout.marginRight,
      marginTop: layout.marginTop,
      marginBottom: layout.marginBottom,
      x: {
        domain: args.ctx.scenarioDomain,
        tickFormat: (d) => {
          const idx = scenarioIndex.get(String(d));
          if (!idx) return '';
          if (labelEvery === 1) return String(idx);
          if (idx === 1 || idx === args.ctx.scenarioDomain.length) return String(idx);
          return idx % labelEvery === 0 ? String(idx) : '';
        },
        tickSize: 0,
        label: null,
      },
      y: { domain: args.ctx.experimentDomain, tickSize: 0, label: null },
      color: { type: 'identity' },
      marks: [
        Plot.cell(cells, {
          x: 'scenarioId',
          y: 'experiment',
          fill: 'fill',
          inset: 1,
          title: (d) =>
            d.total === 0
              ? `${d.experiment} × ${d.scenarioId}\nNot run`
              : d.value === null
                ? `${d.experiment} × ${d.scenarioId}\n${args.spec.valueLabel}: n/a (0/${d.total} runs)`
                : `${d.experiment} × ${d.scenarioId}\n${args.spec.valueLabel}: ${args.spec.formatTitle(d.value)} (n=${d.n})`,
        }),
        Plot.text(cells, {
          x: 'scenarioId',
          y: 'experiment',
          text: 'label',
          fill: 'textFill',
          fontSize: 11,
          textAnchor: 'middle',
          dy: 3,
        }),
        Plot.frame({ stroke: args.ctx.theme.colors.grid }),
      ],
    }),
  });

  return {
    id: args.spec.id,
    title: args.spec.title,
    caption: args.spec.caption,
    svg,
  };
}

export function metricPalette(theme: ArenaReportTheme) {
  // Blue sequential palette in the same hue family as the "ok" color.
  // Overrideable per chart via spec.palette.
  void theme;
  return ['#eff6ff', '#bfdbfe', '#93c5fd', '#60a5fa', '#2563eb', '#1e3a8a'];
}
