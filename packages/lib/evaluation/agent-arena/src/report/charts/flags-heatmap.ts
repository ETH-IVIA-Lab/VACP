import * as Plot from '@observablehq/plot';
import { plotSvg, type SvgLegend } from './plot.js';
import { fmtPct, isDark, marginLeftForLabels, resolveLayout } from './utils.js';
import type { ArenaChart, ArenaFigureLayout } from './types.js';

export type FlagsHeatmapChartConfig = ArenaFigureLayout;

function flagsHeatmapCells(ctx: Parameters<ArenaChart<FlagsHeatmapChartConfig>['getData']>[0]) {
  const flags = [
    { id: 'has_https_tool_calls', label: 'HTTPS tool calls', field: 'hasHttpsToolCalls' as const },
    { id: 'has_read_enoent', label: 'Read ENOENT', field: 'hasReadEnoent' as const },
    { id: 'has_err_connection_refused', label: 'ERR_CONNECTION_REFUSED', field: 'hasErrConnectionRefused' as const },
    { id: 'has_chrome_webdata', label: 'chromewebdata', field: 'hasChromeWebdata' as const },
  ];

  const rows: Array<{
    experiment: string;
    flag_id: string;
    flag_label: string;
    rate: number | null;
    total: number;
    usable: number;
    count: number;
  }> = [];

  for (const flag of flags) {
    for (const experiment of ctx.experimentDomain) {
      const expRuns = ctx.runs.filter((r) => r.experiment === experiment);
      const total = expRuns.length;
      const usable = expRuns.map((r) => r[flag.field]).filter((v): v is boolean => typeof v === 'boolean');
      if (!usable.length) {
        rows.push({ experiment, flag_id: flag.id, flag_label: flag.label, rate: null, total, usable: 0, count: 0 });
        continue;
      }
      const count = usable.filter(Boolean).length;
      const rate = count / usable.length;
      rows.push({ experiment, flag_id: flag.id, flag_label: flag.label, rate, total, usable: usable.length, count });
    }
  }

  const palette = riskPalette();
  const steps = palette.length;
  return rows.map((d) => {
    const fill = d.rate === null ? ctx.theme.colors.grid : palette[Math.min(steps - 1, Math.floor(d.rate * steps))];
    const label = d.rate === null ? 'n/a' : fmtPct(d.rate);
    const text_fill = isDark(fill) ? '#ffffff' : ctx.theme.colors.ink;
    return { ...d, fill, label, text_fill };
  });
}

export const flagsHeatmapChart: ArenaChart<FlagsHeatmapChartConfig> = {
  id: 'flags-heatmap',
  title: 'Policy and Infrastructure Flags — Rate',
  caption:
    'How often key reliability flags appeared in each experiment. Rates use only runs with flag telemetry; missing values are excluded and shown as n/a.',
  isApplicable: (ctx) =>
    ctx.runs.some(
      (r) =>
        r.hasHttpsToolCalls !== null ||
        r.hasReadEnoent !== null ||
        r.hasErrConnectionRefused !== null ||
        r.hasChromeWebdata !== null,
    ),
  getData: (ctx) => flagsHeatmapCells(ctx),
  render: (ctx, config) => {
    const cells = flagsHeatmapCells(ctx);
    const flags = Array.from(new Set(cells.map((d) => d.flag_label)));
    const legend = legendForFlagsHeatmap(ctx);

    const layout = resolveLayout(
      ctx.theme,
      {
        height: Math.max(220, 64 + flags.length * 26),
        marginLeft: marginLeftForLabels(flags, ctx.theme, { min: 140, max: 320 }),
        marginRight: 24,
        marginTop: 24,
        marginBottom: 48,
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
        x: { domain: ctx.experimentDomain, tickRotate: -20, tickSize: 0, label: null },
        y: { domain: flags, tickSize: 0, label: null },
        color: { type: 'identity' },
        marks: [
          Plot.cell(cells, {
            x: 'experiment',
            y: 'flag_label',
            fill: 'fill',
            inset: 0,
            title: (d) => {
              if (d.rate === null)
                return `${d.experiment} × ${d.flag_label}\nRate: n/a (0/${d.total} runs report flag)`;
              const missing = Math.max(0, d.total - d.usable);
              return `${d.experiment} × ${d.flag_label}\nRate: ${fmtPct(d.rate)} (${d.count}/${d.usable}${missing ? `; ${missing} missing` : ''})`;
            },
          }),
          Plot.text(cells, {
            x: 'experiment',
            y: 'flag_label',
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
      id: flagsHeatmapChart.id,
      title: flagsHeatmapChart.title,
      caption: flagsHeatmapChart.caption,
      svg,
      data: cells,
    };
  },
};

function legendForFlagsHeatmap(ctx: Parameters<typeof flagsHeatmapChart.render>[0]): SvgLegend {
  const palette = riskPalette();
  const steps = palette.length;
  const segments = palette.map((fill, i) => ({
    from: i / steps,
    to: (i + 1) / steps,
    fill,
  }));
  const ticks = Array.from({ length: steps + 1 }, (_, i) => {
    const value = i / steps;
    return { value, label: fmtPct(value) };
  });

  return {
    kind: 'ramp',
    title: 'Rate',
    segments,
    ticks,
    extras: [{ label: 'n/a', fill: ctx.theme.colors.grid }],
  };
}

function riskPalette() {
  // Single-hue risk scale used for policy/infra risk rate.
  return ['#fff5f4', '#fee4e2', '#fecdca', '#fda29b', '#f97066', '#d92d20'];
}
