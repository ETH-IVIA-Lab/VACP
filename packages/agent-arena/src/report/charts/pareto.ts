import * as Plot from '@observablehq/plot';
import { plotSvg } from './plot.js';
import { fmtNumber, fmtPct, intTick, maxOf, niceCeil, resolveLayout } from './utils.js';
import type { ArenaChart, ArenaFigureLayout } from './types.js';

export type ParetoChartConfig = ArenaFigureLayout;

export const paretoChart: ArenaChart<ParetoChartConfig> = {
  id: 'pareto',
  title: 'Efficiency vs Correctness (Medians)',
  caption:
    'Each point is one experiment: x = median tokens (no cache), y = median duration (seconds). Labels include strict solved rate.',
  isApplicable: (ctx) =>
    ctx.summaries.some((s) => typeof s.tokensMedianNoCache === 'number' && typeof s.durationMedianS === 'number'),
  render: (ctx, config) => {
    const points = ctx.summaries
      .flatMap((s) => {
        if (typeof s.tokensMedianNoCache !== 'number' || typeof s.durationMedianS !== 'number') return [];
        return [
          {
            experiment: s.experiment,
            tokens: s.tokensMedianNoCache,
            durationS: s.durationMedianS,
            solvedStrictRate: s.solvedStrictRate,
          },
        ];
      })
      .filter((p) => ctx.experimentDomain.includes(p.experiment));

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
          label: 'Median tokens (no cache)',
          tickFormat: intTick,
          domain: [0, niceCeil(maxOf(points, (d) => d.tokens) * 1.05)],
        },
        y: {
          grid: true,
          label: 'Median duration (s)',
          tickFormat: intTick,
          domain: [0, niceCeil(maxOf(points, (d) => d.durationS) * 1.05)],
        },
        marks: [
          Plot.dot(points, {
            x: 'tokens',
            y: 'durationS',
            r: 6,
            fill: ctx.theme.colors.ok,
            stroke: ctx.theme.colors.ink,
            title: (d) =>
              [
                d.experiment,
                `Median: ${fmtNumber(d.tokens)} tokens, ${fmtNumber(Math.round(d.durationS))}s`,
                `Solved (strict): ${d.solvedStrictRate === null ? 'n/a' : fmtPct(d.solvedStrictRate)}`,
              ].join('\n'),
          }),
          Plot.text(points, {
            x: 'tokens',
            y: 'durationS',
            text: (d) => `${d.experiment}${d.solvedStrictRate === null ? '' : ` (${fmtPct(d.solvedStrictRate)})`}`,
            dx: 10,
            dy: -10,
            fontSize: 11,
            fill: ctx.theme.colors.ink,
            textAnchor: 'start',
          }),
        ],
      }),
    });

    return { id: paretoChart.id, title: paretoChart.title, caption: paretoChart.caption, svg };
  },
};
