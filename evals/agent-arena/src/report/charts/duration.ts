import * as Plot from '@observablehq/plot';
import { plotSvg } from './plot.js';
import { fmtNumber, intTick, maxOf, paddedMax, resolveLayout } from './utils.js';
import type { ArenaChart, ArenaFigureLayout } from './types.js';
import { formatSolvedStatus } from './solved-status.js';

export type DurationChartConfig = ArenaFigureLayout;

function durationRows(ctx: Parameters<ArenaChart<DurationChartConfig>['getData']>[0]) {
  return ctx.runs
    .filter((r) => typeof r.durationS === 'number')
    .map((r) => ({
      experiment: r.experiment,
      scenario_id: r.scenarioId,
      duration_s: r.durationS as number,
      solved_strict: r.solvedStrict,
      solved_semantic: r.solvedSemantic,
    }));
}

export const durationChart: ArenaChart<DurationChartConfig> = {
  id: 'duration',
  title: 'Run Duration by Experiment',
  caption: 'How long runs take. Box plots show spread and median. Dots show individual runs.',
  isApplicable: (ctx) => ctx.runs.some((r) => typeof r.durationS === 'number'),
  getData: (ctx) => durationRows(ctx),
  render: (ctx, config) => {
    const data = durationRows(ctx);
    const maxDuration = maxOf(data, (d) => d.duration_s);

    const layout = resolveLayout(
      ctx.theme,
      { height: 320, marginLeft: 64, marginRight: 24, marginTop: 24, marginBottom: 60 },
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
          label: 'Duration (s)',
          tickFormat: intTick,
          nice: false,
          domain: [0, paddedMax(maxDuration)],
        },
        marks: [
          Plot.boxY(data, {
            x: 'experiment',
            y: 'duration_s',
            stroke: ctx.theme.colors.ink,
            fill: '#d3d9e2',
            strokeWidth: 1.2,
          }),
          Plot.dot(data, {
            x: 'experiment',
            y: 'duration_s',
            fill: ctx.theme.colors.info,
            stroke: ctx.theme.colors.info,
            r: 3,
            opacity: 0.5,
            title: (d) =>
              [
                `${d.experiment} × ${d.scenario_id}`,
                `Duration: ${fmtNumber(d.duration_s)}s`,
                `Semantic outcome: ${formatSolvedStatus(d.solved_semantic)}`,
                `Strict outcome: ${formatSolvedStatus(d.solved_strict)}`,
              ].join('\n'),
          }),
        ],
      }),
    });

    return { id: durationChart.id, title: durationChart.title, caption: durationChart.caption, svg, data };
  },
};
