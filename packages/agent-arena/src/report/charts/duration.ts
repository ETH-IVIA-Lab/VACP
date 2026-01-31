import * as Plot from '@observablehq/plot';
import { plotSvg } from './plot.js';
import { fmtNumber, intTick, maxOf, niceCeil, resolveLayout } from './utils.js';
import type { ArenaChart, ArenaFigureLayout } from './types.js';

export type DurationChartConfig = ArenaFigureLayout;

export const durationChart: ArenaChart<DurationChartConfig> = {
  id: 'duration',
  title: 'Run Duration by Experiment',
  caption:
    'Per-run wall clock time (prefers `opencode_duration_ms` when present). Boxplots show distribution; dots show individual runs.',
  isApplicable: (ctx) => ctx.runs.some((r) => typeof r.durationS === 'number'),
  render: (ctx, config) => {
    const data = ctx.runs
      .filter((r) => typeof r.durationS === 'number')
      .map((r) => ({
        experiment: r.experiment,
        scenarioId: r.scenarioId,
        durationS: r.durationS as number,
        solvedStrict: r.solvedStrict,
        solvedSemantic: r.solvedSemantic,
      }));
    const maxDuration = maxOf(data, (d) => d.durationS);

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
        y: { grid: true, label: 'Duration (s)', tickFormat: intTick, domain: [0, niceCeil(maxDuration * 1.05)] },
        marks: [
          Plot.boxY(data, { x: 'experiment', y: 'durationS', stroke: ctx.theme.colors.ink }),
          Plot.dot(data, {
            x: 'experiment',
            y: 'durationS',
            fill: ctx.theme.colors.neutral,
            stroke: ctx.theme.colors.neutral,
            r: 3,
            opacity: 0.45,
            title: (d) =>
              [
                `${d.experiment} × ${d.scenarioId}`,
                `Duration: ${fmtNumber(d.durationS)}s`,
                `Solved (strict): ${d.solvedStrict === null ? 'n/a' : d.solvedStrict ? 'yes' : 'no'}`,
                `Solved (semantic): ${d.solvedSemantic === null ? 'n/a' : d.solvedSemantic ? 'yes' : 'no'}`,
              ].join('\n'),
          }),
        ],
      }),
    });

    return { id: durationChart.id, title: durationChart.title, caption: durationChart.caption, svg };
  },
};
