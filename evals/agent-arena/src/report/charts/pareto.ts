import * as Plot from '@observablehq/plot';
import { plotSvg } from './plot.js';
import { fmtNumber, fmtPct, intTick, maxOf, paddedMax, resolveLayout } from './utils.js';
import type { ArenaChart, ArenaFigureLayout } from './types.js';

export type ParetoChartConfig = ArenaFigureLayout;

function paretoPoints(ctx: Parameters<ArenaChart<ParetoChartConfig>['getData']>[0]) {
  return ctx.summaries
    .flatMap((s) => {
      if (typeof s.tokensMedianNoCache !== 'number' || typeof s.durationMedianS !== 'number') return [];

      return [
        {
          experiment: s.experiment,
          tokens_median_no_cache: s.tokensMedianNoCache,
          duration_s_median: s.durationMedianS,
          solved_semantic_rate: s.solvedSemanticRate,
          solved_strict_rate: s.solvedStrictRate,
        },
      ];
    })
    .filter((p) => ctx.experimentDomain.includes(p.experiment));
}

export const paretoChart: ArenaChart<ParetoChartConfig> = {
  id: 'pareto',
  title: 'Duration vs Tokens: Medians',
  caption:
    'Each point is one experiment. Right means more median tokens (without cache), up means slower runs. Labels include semantic solved rate (strict shown secondarily in tooltip).',
  isApplicable: (ctx) =>
    ctx.summaries.some((s) => typeof s.tokensMedianNoCache === 'number' && typeof s.durationMedianS === 'number'),
  getData: (ctx) => paretoPoints(ctx),
  render: (ctx, config) => {
    const points = paretoPoints(ctx);

    const layout = resolveLayout(
      ctx.theme,
      { height: 320, marginLeft: 80, marginRight: 24, marginTop: 24, marginBottom: 58 },
      config,
    );

    const svg = plotSvg({
      theme: ctx.theme,
      plot: Plot.plot({
        document: ctx.document,
        width: layout.width,
        height: layout.height,
        marginLeft: layout.marginLeft,
        marginRight: layout.marginRight,
        marginTop: layout.marginTop,
        marginBottom: layout.marginBottom,
        x: {
          grid: true,
          label: 'Median tokens',
          tickFormat: intTick,
          nice: false,
          domain: [0, paddedMax(maxOf(points, (d) => d.tokens_median_no_cache))],
        },
        y: {
          grid: true,
          label: 'Median duration (s)',
          tickFormat: intTick,
          nice: false,
          domain: [0, paddedMax(maxOf(points, (d) => d.duration_s_median))],
        },
        marks: [
          Plot.dot(points, {
            x: 'tokens_median_no_cache',
            y: 'duration_s_median',
            r: 6,
            fill: ctx.theme.colors.info,
            stroke: ctx.theme.colors.ink,
            title: (d) =>
              [
                d.experiment,
                `Median: ${fmtNumber(d.tokens_median_no_cache)} tokens (without cache), ${fmtNumber(Math.round(d.duration_s_median))}s`,
                `Solved semantic: ${d.solved_semantic_rate === null ? 'n/a' : fmtPct(d.solved_semantic_rate)}`,
                `Solved strict: ${d.solved_strict_rate === null ? 'n/a' : fmtPct(d.solved_strict_rate)}`,
              ].join('\n'),
          }),
          Plot.text(points, {
            x: 'tokens_median_no_cache',
            y: 'duration_s_median',
            text: (d) =>
              `${d.experiment}${d.solved_semantic_rate === null ? '' : ` (${fmtPct(d.solved_semantic_rate)})`}`,
            dx: 10,
            dy: -10,
            fontSize: 11,
            fill: ctx.theme.colors.ink,
            textAnchor: 'start',
          }),
        ],
      }),
    });

    return { id: paretoChart.id, title: paretoChart.title, caption: paretoChart.caption, svg, data: points };
  },
};
