import * as Plot from '@observablehq/plot';
import { plotSvg } from './plot.js';
import { fmtNumber, intTick, maxOf, niceCeil, resolveLayout } from './utils.js';
import type { ArenaChart, ArenaFigureLayout } from './types.js';

export type ToolCallsChartConfig = ArenaFigureLayout;

export const toolCallsChart: ArenaChart<ToolCallsChartConfig> = {
  id: 'tool-calls',
  title: 'Tool Calls by Experiment',
  caption: 'Tool calls counted from OpenCode message parts (includes bash/browser helpers and MCP tools).',
  isApplicable: (ctx) => ctx.runs.some((r) => typeof r.toolCalls === 'number'),
  render: (ctx, config) => {
    const data = ctx.runs
      .filter((r) => typeof r.toolCalls === 'number')
      .map((r) => ({
        experiment: r.experiment,
        scenarioId: r.scenarioId,
        toolCalls: r.toolCalls as number,
        toolErrors: r.toolErrors ?? 0,
        solvedStrict: r.solvedStrict,
        solvedSemantic: r.solvedSemantic,
      }));
    const maxToolCalls = maxOf(data, (d) => d.toolCalls);

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
        y: { grid: true, label: 'Tool calls (count)', tickFormat: intTick, domain: [0, niceCeil(maxToolCalls * 1.05)] },
        marks: [
          Plot.boxY(data, { x: 'experiment', y: 'toolCalls', stroke: ctx.theme.colors.ink }),
          Plot.dot(data, {
            x: 'experiment',
            y: 'toolCalls',
            fill: ctx.theme.colors.neutral,
            stroke: ctx.theme.colors.neutral,
            r: 3,
            opacity: 0.45,
            title: (d) =>
              [
                `${d.experiment} × ${d.scenarioId}`,
                `Tool calls: ${fmtNumber(d.toolCalls)} (${fmtNumber(d.toolErrors)} errors)`,
                `Solved (strict): ${d.solvedStrict === null ? 'n/a' : d.solvedStrict ? 'yes' : 'no'}`,
                `Solved (semantic): ${d.solvedSemantic === null ? 'n/a' : d.solvedSemantic ? 'yes' : 'no'}`,
              ].join('\n'),
          }),
        ],
      }),
    });

    return { id: toolCallsChart.id, title: toolCallsChart.title, caption: toolCallsChart.caption, svg };
  },
};
