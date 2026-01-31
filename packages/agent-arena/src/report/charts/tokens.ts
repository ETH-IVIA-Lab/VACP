import * as Plot from '@observablehq/plot';
import { plotSvg } from './plot.js';
import { fmtNumber, intTick, maxOf, niceCeil, resolveLayout } from './utils.js';
import type { ArenaChart, ArenaFigureLayout } from './types.js';

export type TokensChartConfig = ArenaFigureLayout;

export const tokensChart: ArenaChart<TokensChartConfig> = {
  id: 'tokens',
  title: 'Token Use by Experiment',
  caption: 'Token totals exclude cache reads (prefers `tokens_total_no_cache` when present).',
  isApplicable: (ctx) => ctx.runs.some((r) => typeof r.tokensTotalNoCache === 'number'),
  render: (ctx, config) => {
    const data = ctx.runs
      .filter((r) => typeof r.tokensTotalNoCache === 'number')
      .map((r) => ({
        experiment: r.experiment,
        scenarioId: r.scenarioId,
        tokens: r.tokensTotalNoCache as number,
        solvedStrict: r.solvedStrict,
        solvedSemantic: r.solvedSemantic,
      }));
    const maxTokens = maxOf(data, (d) => d.tokens);

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
          Plot.boxY(data, { x: 'experiment', y: 'tokens', stroke: ctx.theme.colors.ink }),
          Plot.dot(data, {
            x: 'experiment',
            y: 'tokens',
            fill: ctx.theme.colors.neutral,
            stroke: ctx.theme.colors.neutral,
            r: 3,
            opacity: 0.45,
            title: (d) =>
              [
                `${d.experiment} × ${d.scenarioId}`,
                `Tokens: ${fmtNumber(d.tokens)}`,
                `Solved (strict): ${d.solvedStrict === null ? 'n/a' : d.solvedStrict ? 'yes' : 'no'}`,
                `Solved (semantic): ${d.solvedSemantic === null ? 'n/a' : d.solvedSemantic ? 'yes' : 'no'}`,
              ].join('\n'),
          }),
        ],
      }),
    });

    return { id: tokensChart.id, title: tokensChart.title, caption: tokensChart.caption, svg };
  },
};
