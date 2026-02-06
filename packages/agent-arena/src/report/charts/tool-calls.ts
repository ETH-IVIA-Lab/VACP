import * as Plot from '@observablehq/plot';
import { plotSvg } from './plot.js';
import { fmtNumber, intTick, maxOf, paddedMax, resolveLayout } from './utils.js';
import type { ArenaChart, ArenaFigureLayout } from './types.js';

export type ToolCallsChartConfig = ArenaFigureLayout;

function toolCallRows(ctx: Parameters<ArenaChart<ToolCallsChartConfig>['getData']>[0]) {
  return ctx.runs
    .filter((r) => typeof r.toolCalls === 'number')
    .map((r) => ({
      experiment: r.experiment,
      scenario_id: r.scenarioId,
      tool_calls: r.toolCalls as number,
      tool_errors: r.toolErrors ?? 0,
      solved_strict: r.solvedStrict,
      solved_semantic: r.solvedSemantic,
    }));
}

export const toolCallsChart: ArenaChart<ToolCallsChartConfig> = {
  id: 'tool-calls',
  title: 'Tool Calls by Experiment',
  caption: 'How heavily each experiment used tools across runs.',
  isApplicable: (ctx) => ctx.runs.some((r) => typeof r.toolCalls === 'number'),
  getData: (ctx) => toolCallRows(ctx),
  render: (ctx, config) => {
    const data = toolCallRows(ctx);
    const maxToolCalls = maxOf(data, (d) => d.tool_calls);

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
          label: 'Tool calls (count)',
          tickFormat: intTick,
          nice: false,
          domain: [0, paddedMax(maxToolCalls)],
        },
        marks: [
          Plot.boxY(data, {
            x: 'experiment',
            y: 'tool_calls',
            stroke: ctx.theme.colors.ink,
            fill: '#d3d9e2',
            strokeWidth: 1.2,
          }),
          Plot.dot(data, {
            x: 'experiment',
            y: 'tool_calls',
            fill: ctx.theme.colors.info,
            stroke: ctx.theme.colors.info,
            r: 3,
            opacity: 0.5,
            title: (d) =>
              [
                `${d.experiment} × ${d.scenario_id}`,
                `Tool calls: ${fmtNumber(d.tool_calls)} (${fmtNumber(d.tool_errors)} errors)`,
                `Solved strict: ${d.solved_strict === null ? 'n/a' : d.solved_strict ? 'yes' : 'no'}`,
                `Solved semantic: ${d.solved_semantic === null ? 'n/a' : d.solved_semantic ? 'yes' : 'no'}`,
              ].join('\n'),
          }),
        ],
      }),
    });

    return { id: toolCallsChart.id, title: toolCallsChart.title, caption: toolCallsChart.caption, svg, data };
  },
};
