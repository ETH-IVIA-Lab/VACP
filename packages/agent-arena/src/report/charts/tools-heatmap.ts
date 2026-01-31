import * as Plot from '@observablehq/plot';
import { plotSvg } from './plot.js';
import { bucketIndex, fmtNumber, isDark, marginLeftForLabels, quantiles, resolveLayout } from './utils.js';
import type { ArenaChart, ArenaFigureLayout } from './types.js';
import type { ToolByExperimentRow } from '../stats.js';

export type ToolsHeatmapChartConfig = ArenaFigureLayout & {
  topK?: number;
};

export const toolsHeatmapChart: ArenaChart<ToolsHeatmapChartConfig> = {
  id: 'tools-heatmap',
  title: 'Top Tools by Call Count',
  caption:
    'Heatmap of tool call counts by experiment for the top tools (by total calls), plus an “other” bucket. Cell text is the exact call count; background is a quantized scale for quick scanning.',
  isApplicable: (ctx) => ctx.toolByExperiment.length > 0,
  render: (ctx, config) => {
    const topK = config?.topK ?? 10;
    const topTools = topKTools(ctx.toolByExperiment, topK);
    const toolLabels = makeUniqueToolLabels(topTools);
    const toolLabelByTool = new Map<string, string>(topTools.map((t, i) => [t, toolLabels[i]] as const));
    const yDomain = [...toolLabels, 'other'];

    const collapsed = collapseOtherTools(ctx.toolByExperiment, topTools);
    const byKey = new Map<string, number>();
    for (const r of collapsed) {
      const label = r.tool === 'other' ? 'other' : (toolLabelByTool.get(r.tool) ?? r.tool);
      byKey.set(`${r.experiment}__${label}`, r.calls);
    }

    const data = [];
    for (const tool of yDomain) {
      for (const experiment of ctx.experimentDomain) {
        const calls = byKey.get(`${experiment}__${tool}`) ?? 0;
        data.push({ experiment, tool, calls });
      }
    }

    const q = quantiles(
      data.map((d) => d.calls),
      [0.2, 0.4, 0.6, 0.8],
    );
    const palette = ['#eff6ff', '#bfdbfe', '#93c5fd', '#60a5fa', '#2563eb', '#1e3a8a'];
    const cells = data.map((d) => {
      const fill = palette[bucketIndex(d.calls, q)];
      return {
        ...d,
        fill,
        label: d.calls ? fmtNumber(d.calls) : '',
        textFill: isDark(fill) ? '#ffffff' : ctx.theme.colors.ink,
      };
    });

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
            y: 'tool',
            fill: 'fill',
            inset: 1,
            title: (d) => `${d.experiment} × ${d.tool}\nCalls: ${fmtNumber(d.calls)}`,
          }),
          Plot.text(cells, {
            x: 'experiment',
            y: 'tool',
            text: 'label',
            fill: 'textFill',
            fontSize: 11,
            textAnchor: 'middle',
            dy: 3,
          }),
          Plot.frame({ stroke: ctx.theme.colors.grid }),
        ],
      }),
    });

    return { id: toolsHeatmapChart.id, title: toolsHeatmapChart.title, caption: toolsHeatmapChart.caption, svg };
  },
};

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
