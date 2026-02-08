import * as Plot from '@observablehq/plot';
import { plotSvg, type SvgLegend } from './plot.js';
import { fmtNumber, isDark, linearTicks, marginLeftForLabels, normalize01, resolveLayout } from './utils.js';
import type { ArenaChart, ArenaFigureLayout, ArenaReportTheme } from './types.js';
import type { ToolByExperimentRow } from '../stats.js';
import { metricPalette } from './scenario-metric-heatmap.js';

export type ToolsHeatmapChartConfig = ArenaFigureLayout & {
  topK?: number;
};

function toolsHeatmapCells(
  ctx: Parameters<ArenaChart<ToolsHeatmapChartConfig>['getData']>[0],
  config?: ToolsHeatmapChartConfig,
) {
  const topK = config?.topK ?? 10;
  const topTools = topKTools(ctx.toolByExperiment, topK);
  const toolLabels = makeUniqueToolLabels(topTools);
  const toolLabelByTool = new Map<string, string>(topTools.map((t, i) => [t, toolLabels[i]] as const));

  const displayTools: Array<{ tool_raw: string; tool_label: string }> = [
    ...topTools.map((tool_raw) => ({ tool_raw, tool_label: toolLabelByTool.get(tool_raw) ?? tool_raw })),
    { tool_raw: 'other', tool_label: 'other' },
  ];

  const collapsed = collapseOtherTools(ctx.toolByExperiment, topTools);
  const byKey = new Map<string, number>();
  for (const r of collapsed) byKey.set(`${r.experiment}__${r.tool}`, r.calls);

  const runsByExperiment = new Map<string, number>();
  for (const run of ctx.runs) {
    if (!run.experiment) continue;
    runsByExperiment.set(run.experiment, (runsByExperiment.get(run.experiment) ?? 0) + 1);
  }

  const rows: Array<{
    experiment: string;
    tool_raw: string;
    tool_label: string;
    calls: number;
    run_count: number;
    calls_per_run: number | null;
  }> = [];
  for (const tool of displayTools) {
    for (const experiment of ctx.experimentDomain) {
      const calls = byKey.get(`${experiment}__${tool.tool_raw}`) ?? 0;
      const runCount = runsByExperiment.get(experiment) ?? 0;
      const callsPerRun = runCount > 0 ? calls / runCount : null;
      rows.push({
        experiment,
        tool_raw: tool.tool_raw,
        tool_label: tool.tool_label,
        calls,
        run_count: runCount,
        calls_per_run: callsPerRun,
      });
    }
  }

  const callValues = rows
    .map((d) => d.calls_per_run)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const minCalls = callValues.length ? Math.min(...callValues) : 0;
  const maxCalls = callValues.length ? Math.max(...callValues) : 0;
  const palette = metricPalette(ctx.theme);
  const steps = Math.max(1, palette.length);
  return rows.map((d) => {
    const fill =
      d.calls_per_run === null
        ? ctx.theme.colors.grid
        : palette[Math.min(steps - 1, Math.floor(normalize01(d.calls_per_run, minCalls, maxCalls) * steps))];
    return {
      ...d,
      fill,
      label: d.calls_per_run === null ? 'n/a' : formatCallsPerRun(d.calls_per_run),
      text_fill: isDark(fill) ? '#ffffff' : ctx.theme.colors.ink,
    };
  });
}

export const toolsHeatmapChart: ArenaChart<ToolsHeatmapChartConfig> = {
  id: 'tools-heatmap',
  title: 'Top Tools by Calls per Run',
  caption: 'Top tools normalized by run count, shown per experiment. Cells show calls per run.',
  isApplicable: (ctx) => ctx.toolByExperiment.length > 0,
  getData: (ctx, config) => toolsHeatmapCells(ctx, config),
  render: (ctx, config) => {
    const topK = config?.topK ?? 10;
    const topTools = topKTools(ctx.toolByExperiment, topK);
    const toolLabels = makeUniqueToolLabels(topTools);
    const yDomain = [...toolLabels, 'other'];
    const cells = toolsHeatmapCells(ctx, config);
    const legend = legendForToolsHeatmap(cells, ctx.theme);

    const layout = resolveLayout(
      ctx.theme,
      {
        height: Math.max(260, 52 + yDomain.length * 26),
        marginLeft: marginLeftForLabels(yDomain, ctx.theme, { min: 160, max: 360 }),
        marginRight: 24,
        marginTop: 24,
        marginBottom: 56,
      },
      config,
    );

    const svg = plotSvg({
      theme: ctx.theme,
      legend,
      plot: Plot.plot({
        document: ctx.document,
        width: layout.width,
        height: layout.height,
        marginLeft: layout.marginLeft,
        marginRight: layout.marginRight,
        marginTop: layout.marginTop,
        marginBottom: layout.marginBottom,
        x: { domain: ctx.experimentDomain, tickRotate: -20, label: null, tickSize: 0 },
        y: { domain: yDomain, label: null, tickSize: 0 },
        color: { type: 'identity' },
        marks: [
          Plot.cell(cells, {
            x: 'experiment',
            y: 'tool_label',
            fill: 'fill',
            inset: 0,
            title: (d) =>
              `${d.experiment} × ${d.tool_raw}\nCalls per run: ${d.calls_per_run === null ? 'n/a' : formatCallsPerRun(d.calls_per_run)}\nCalls: ${fmtNumber(d.calls)}\nRuns: ${fmtNumber(d.run_count)}`,
          }),
          Plot.text(cells, {
            x: 'experiment',
            y: 'tool_label',
            text: 'label',
            fill: 'text_fill',
            fontSize: 11,
            textAnchor: 'middle',
            dy: 3,
          }),
        ],
      }),
    });

    return {
      id: toolsHeatmapChart.id,
      title: toolsHeatmapChart.title,
      caption: toolsHeatmapChart.caption,
      svg,
      data: cells,
    };
  },
};

function legendForToolsHeatmap(
  cells: Array<{ fill: string; calls_per_run: number | null }>,
  theme: ArenaReportTheme,
): SvgLegend {
  const values = cells
    .map((cell) => cell.calls_per_run)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!values.length) return { kind: 'swatches', title: 'Calls per run', items: [] };
  const minCalls = Math.min(...values);
  const maxCalls = Math.max(...values);
  const palette = metricPalette(theme);
  const steps = Math.max(1, palette.length);
  const span = Math.max(1e-9, maxCalls - minCalls);
  const stepSize = span / steps;
  const segments = Array.from({ length: steps }, (_, i) => ({
    from: minCalls + i * stepSize,
    to: minCalls + (i + 1) * stepSize,
    fill: palette[Math.min(i, palette.length - 1)],
  }));
  const tickValues = linearTicks(minCalls, minCalls + span, steps + 1);

  return {
    kind: 'ramp',
    title: 'Calls per run',
    segments,
    ticks: tickValues.map((value) => ({
      value,
      label: formatCallsPerRun(value),
    })),
  };
}

function formatCallsPerRun(value: number) {
  if (!Number.isFinite(value)) return 'n/a';
  const rounded = value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return rounded.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

function topKTools(rows: ToolByExperimentRow[], k: number) {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.tool, (totals.get(r.tool) ?? 0) + r.calls);
  const sorted = Array.from(totals.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return sorted.slice(0, k).map(([tool]) => tool);
}

function collapseOtherTools(rows: ToolByExperimentRow[], keep: string[]) {
  const keepSet = new Set(keep);
  const byKey = new Map<string, { experiment: string; tool: string; calls: number }>();
  for (const r of rows) {
    const tool = keepSet.has(r.tool) ? r.tool : 'other';
    const key = `${r.experiment}__${tool}`;
    const cur = byKey.get(key) ?? { experiment: r.experiment, tool, calls: 0 };
    cur.calls += r.calls;
    byKey.set(key, cur);
  }
  return Array.from(byKey.values());
}

function makeUniqueToolLabels(tools: string[]) {
  const labels: string[] = [];
  const seen = new Map<string, number>();
  for (const tool of tools) {
    const base = formatToolLabel(tool);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    labels.push(count ? `${base} (${count + 1})` : base);
  }
  return labels;
}

function formatToolLabel(tool: string) {
  if (tool === 'bash' || tool === 'read') return tool;
  if (tool === 'other') return tool;

  let prefix = '';
  let rest = tool;
  const toolkitPrefix = 'arena_vacp_toolkit_';
  const vacpPrefix = 'arena_vacp_';
  if (rest.startsWith(toolkitPrefix)) {
    prefix = 'toolkit:';
    rest = rest.slice(toolkitPrefix.length);
  } else if (rest.startsWith(vacpPrefix)) {
    prefix = 'vacp:';
    rest = rest.slice(vacpPrefix.length);
  }

  if (rest.startsWith('browser_')) rest = `browser/${rest.slice('browser_'.length)}`;
  else if (rest.startsWith('vacp_')) rest = `vacp/${rest.slice('vacp_'.length)}`;

  if (prefix === 'vacp:' && rest.startsWith('vacp/')) rest = rest.slice('vacp/'.length);
  return `${prefix}${rest}`;
}
