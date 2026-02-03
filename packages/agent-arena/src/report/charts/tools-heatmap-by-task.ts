import * as Plot from '@observablehq/plot';
import { plotSvg, type SvgLegend } from './plot.js';
import { bucketIndex, fmtNumber, isDark, marginLeftForLabels, quantiles, resolveLayout, tickStep } from './utils.js';
import type { ArenaChart, ArenaFigureLayout } from './types.js';
import type { ToolByScenarioRow } from '../stats.js';

export type ToolsHeatmapByTaskChartConfig = ArenaFigureLayout & {
  topK?: number;
};

function toolsHeatmapByTaskCells(
  ctx: Parameters<ArenaChart<ToolsHeatmapByTaskChartConfig>['getData']>[0],
  config?: ToolsHeatmapByTaskChartConfig,
) {
  const topK = config?.topK ?? 10;
  const topTools = topKTools(ctx.toolByScenario, topK);
  const toolLabels = makeUniqueToolLabels(topTools);
  const toolLabelByTool = new Map<string, string>(topTools.map((t, i) => [t, toolLabels[i]] as const));

  const displayTools: Array<{ tool_raw: string; tool_label: string }> = [
    ...topTools.map((tool_raw) => ({ tool_raw, tool_label: toolLabelByTool.get(tool_raw) ?? tool_raw })),
    { tool_raw: 'other', tool_label: 'other' },
  ];

  const collapsed = collapseOtherTools(ctx.toolByScenario, topTools);
  const byKey = new Map<string, number>();
  for (const r of collapsed) byKey.set(`${r.scenarioId}__${r.tool}`, r.calls);

  const rows: Array<{ scenario_id: string; tool_raw: string; tool_label: string; calls: number }> = [];
  for (const tool of displayTools) {
    for (const scenarioId of ctx.scenarioDomain) {
      const calls = byKey.get(`${scenarioId}__${tool.tool_raw}`) ?? 0;
      rows.push({ scenario_id: scenarioId, tool_raw: tool.tool_raw, tool_label: tool.tool_label, calls });
    }
  }

  const q = quantiles(
    rows.map((d) => d.calls),
    [0.2, 0.4, 0.6, 0.8],
  );
  const palette = ['#eff6ff', '#bfdbfe', '#93c5fd', '#60a5fa', '#2563eb', '#1e3a8a'];
  return rows.map((d) => {
    const fill = palette[bucketIndex(d.calls, q)];
    return {
      ...d,
      fill,
      label: d.calls ? fmtNumber(d.calls) : '',
      text_fill: isDark(fill) ? '#ffffff' : ctx.theme.colors.ink,
    };
  });
}

export const toolsHeatmapByTaskChart: ArenaChart<ToolsHeatmapByTaskChartConfig> = {
  id: 'tools-heatmap-by-task',
  title: 'Top Tools by Call Count (by Task)',
  caption:
    'Heatmap of tool call counts by task for the top tools (by total calls), plus an “other” bucket. Cell text is the exact call count; background is a quantized scale for quick scanning.',
  isApplicable: (ctx) => ctx.toolByScenario.length > 0,
  getData: (ctx, config) => toolsHeatmapByTaskCells(ctx, config),
  render: (ctx, config) => {
    const topK = config?.topK ?? 10;
    const topTools = topKTools(ctx.toolByScenario, topK);
    const toolLabels = makeUniqueToolLabels(topTools);
    const yDomain = [...toolLabels, 'other'];
    const cells = toolsHeatmapByTaskCells(ctx, config);
    const legend = legendForToolsHeatmapByTask(cells);

    const scenarioIndex = new Map<string, number>();
    for (const [i, id] of ctx.scenarioDomain.entries()) scenarioIndex.set(id, i + 1);
    const labelEvery = tickStep(ctx.scenarioDomain.length);

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
        x: {
          domain: ctx.scenarioDomain,
          tickFormat: (d) => {
            const idx = scenarioIndex.get(String(d));
            if (!idx) return '';
            if (labelEvery === 1) return String(idx);
            if (idx === 1 || idx === ctx.scenarioDomain.length) return String(idx);
            return idx % labelEvery === 0 ? String(idx) : '';
          },
          tickSize: 0,
          label: null,
        },
        y: { domain: yDomain, label: null, tickSize: 0 },
        color: { type: 'identity' },
        marks: [
          Plot.cell(cells, {
            x: 'scenario_id',
            y: 'tool_label',
            fill: 'fill',
            inset: 1,
            title: (d) => `${d.scenario_id} × ${d.tool_raw}\nCalls: ${fmtNumber(d.calls)}`,
          }),
          Plot.text(cells, {
            x: 'scenario_id',
            y: 'tool_label',
            text: 'label',
            fill: 'text_fill',
            fontSize: 11,
            textAnchor: 'middle',
            dy: 3,
          }),
          Plot.frame({ stroke: ctx.theme.colors.grid }),
        ],
      }),
    });

    return {
      id: toolsHeatmapByTaskChart.id,
      title: toolsHeatmapByTaskChart.title,
      caption: toolsHeatmapByTaskChart.caption,
      svg,
      data: cells,
    };
  },
};

function legendForToolsHeatmapByTask(cells: Array<{ fill: string; calls: number }>): SvgLegend {
  const valuesByFill = new Map<string, number[]>();
  for (const cell of cells) {
    const list = valuesByFill.get(cell.fill) ?? [];
    list.push(cell.calls);
    valuesByFill.set(cell.fill, list);
  }

  const bins = Array.from(valuesByFill.entries())
    .map(([fill, values]) => {
      let min = Infinity;
      let max = -Infinity;
      for (const v of values) {
        if (!Number.isFinite(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      return { fill, min, max };
    })
    .filter((d) => Number.isFinite(d.min) && Number.isFinite(d.max))
    .sort((a, b) => a.min - b.min || a.max - b.max);

  if (!bins.length) return { kind: 'swatches', title: 'Calls', items: [] };

  return {
    kind: 'ramp',
    title: 'Calls',
    segments: bins.map((b) => ({ from: b.min, to: b.max, fill: b.fill })),
    ticks: Array.from(new Set([bins[0].min, ...bins.map((b) => b.max)])).map((value) => ({
      value,
      label: fmtNumber(value),
    })),
  };
}

function topKTools(rows: ToolByScenarioRow[], k: number) {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.tool, (totals.get(r.tool) ?? 0) + r.calls);
  const sorted = Array.from(totals.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return sorted.slice(0, k).map(([tool]) => tool);
}

function collapseOtherTools(rows: ToolByScenarioRow[], keep: string[]) {
  const keepSet = new Set(keep);
  const byKey = new Map<string, { scenarioId: string; tool: string; calls: number }>();
  for (const r of rows) {
    const tool = keepSet.has(r.tool) ? r.tool : 'other';
    const key = `${r.scenarioId}__${tool}`;
    const cur = byKey.get(key) ?? { scenarioId: r.scenarioId, tool, calls: 0 };
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

