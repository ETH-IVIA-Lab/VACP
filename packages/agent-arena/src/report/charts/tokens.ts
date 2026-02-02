import * as Plot from '@observablehq/plot';
import { plotSvg } from './plot.js';
import { fmtNumber, intTick, maxOf, niceCeil, resolveLayout } from './utils.js';
import type { ArenaChart, ArenaFigureLayout } from './types.js';

export type TokensChartConfig = ArenaFigureLayout;

function tokenRows(ctx: Parameters<ArenaChart<TokensChartConfig>['getData']>[0]) {
  return ctx.runs
    .filter((r) => typeof r.tokensTotalNoCache === 'number')
    .map((r) => ({
      experiment: r.experiment,
      scenario_id: r.scenarioId,
      tokens_total_no_cache: r.tokensTotalNoCache as number,
      solved_strict: r.solvedStrict,
      solved_semantic: r.solvedSemantic,
    }));
}

export const tokensChart: ArenaChart<TokensChartConfig> = {
  id: 'tokens',
  title: 'Token Use by Experiment',
  caption: 'Token totals exclude cache reads (prefers `tokens_total_no_cache` when present).',
  isApplicable: (ctx) => ctx.runs.some((r) => typeof r.tokensTotalNoCache === 'number'),
  getData: (ctx) => tokenRows(ctx),
  render: (ctx, config) => {
    const data = tokenRows(ctx);
    const maxTokens = maxOf(data, (d) => d.tokens_total_no_cache);

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
          label: 'Tokens (input+output+reasoning)',
          tickFormat: intTick,
          domain: [0, niceCeil(maxTokens * 1.05)],
        },
        marks: [
          Plot.boxY(data, { x: 'experiment', y: 'tokens_total_no_cache', stroke: ctx.theme.colors.ink }),
          Plot.dot(data, {
            x: 'experiment',
            y: 'tokens_total_no_cache',
            fill: ctx.theme.colors.neutral,
            stroke: ctx.theme.colors.neutral,
            r: 3,
            opacity: 0.45,
            title: (d) =>
              [
                `${d.experiment} × ${d.scenario_id}`,
                `Tokens: ${fmtNumber(d.tokens_total_no_cache)}`,
                `Solved (strict): ${d.solved_strict === null ? 'n/a' : d.solved_strict ? 'yes' : 'no'}`,
                `Solved (semantic): ${d.solved_semantic === null ? 'n/a' : d.solved_semantic ? 'yes' : 'no'}`,
              ].join('\n'),
          }),
        ],
      }),
    });

    return { id: tokensChart.id, title: tokensChart.title, caption: tokensChart.caption, svg, data };
  },
};
