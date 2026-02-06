import * as Plot from '@observablehq/plot';
import { plotSvg } from './plot.js';
import { fmtNumber, intTick, maxOf, paddedMax, resolveLayout } from './utils.js';
import type { ArenaChart, ArenaFigureLayout } from './types.js';

export type TokensChartConfig = ArenaFigureLayout;

function tokenRows(ctx: Parameters<ArenaChart<TokensChartConfig>['getData']>[0]) {
  return ctx.runs
    .filter((r) => typeof r.tokensTotalWithCacheAll === 'number')
    .map((r) => ({
      experiment: r.experiment,
      scenario_id: r.scenarioId,
      tokens_total_with_cache: r.tokensTotalWithCacheAll as number,
      solved_strict: r.solvedStrict,
      solved_semantic: r.solvedSemantic,
    }));
}

export const tokensChart: ArenaChart<TokensChartConfig> = {
  id: 'tokens',
  title: 'Token Use by Experiment — With Cache',
  caption: 'Per-run token usage with cache. Use Token Accounting for the full with-cache vs no-cache breakdown.',
  isApplicable: (ctx) => ctx.runs.some((r) => typeof r.tokensTotalWithCacheAll === 'number'),
  getData: (ctx) => tokenRows(ctx),
  render: (ctx, config) => {
    const data = tokenRows(ctx);
    const maxTokens = maxOf(data, (d) => d.tokens_total_with_cache);

    const layout = resolveLayout(
      ctx.theme,
      { height: 320, marginLeft: 72, marginRight: 24, marginTop: 24, marginBottom: 60 },
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
        x: { domain: ctx.experimentDomain, tickRotate: -20, label: null },
        y: {
          grid: true,
          label: 'Tokens with cache',
          tickFormat: intTick,
          nice: false,
          domain: [0, paddedMax(maxTokens)],
        },
        marks: [
          Plot.boxY(data, {
            x: 'experiment',
            y: 'tokens_total_with_cache',
            stroke: ctx.theme.colors.ink,
            fill: '#d3d9e2',
            strokeWidth: 1.2,
          }),
          Plot.dot(data, {
            x: 'experiment',
            y: 'tokens_total_with_cache',
            fill: ctx.theme.colors.info,
            stroke: ctx.theme.colors.info,
            r: 3,
            opacity: 0.5,
            title: (d) =>
              [
                `${d.experiment} × ${d.scenario_id}`,
                `Tokens with cache: ${fmtNumber(d.tokens_total_with_cache)}`,
                `Solved strict: ${d.solved_strict === null ? 'n/a' : d.solved_strict ? 'yes' : 'no'}`,
                `Solved semantic: ${d.solved_semantic === null ? 'n/a' : d.solved_semantic ? 'yes' : 'no'}`,
              ].join('\n'),
          }),
        ],
      }),
    });

    return { id: tokensChart.id, title: tokensChart.title, caption: tokensChart.caption, svg, data };
  },
};
