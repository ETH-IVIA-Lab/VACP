import * as Plot from '@observablehq/plot';
import { plotSvg } from './plot.js';
import { fmtPct, isDark, marginLeftForLabels, resolveLayout } from './utils.js';
import type { ArenaChart, ArenaFigureLayout } from './types.js';

export type FlagsHeatmapChartConfig = ArenaFigureLayout;

export const flagsHeatmapChart: ArenaChart<FlagsHeatmapChartConfig> = {
  id: 'flags-heatmap',
  title: 'Policy / Infra Flags (Rate)',
  caption:
    'Rate of “red flag” conditions per experiment. HTTPS tool calls indicate external network use; the others are common infra / filesystem issues during automation.',
  isApplicable: (ctx) =>
    ctx.runs.some(
      (r) =>
        r.hasHttpsToolCalls !== null ||
        r.hasReadEnoent !== null ||
        r.hasErrConnectionRefused !== null ||
        r.hasChromeWebdata !== null,
    ),
  render: (ctx, config) => {
    const flags = [
      { id: 'hasHttpsToolCalls', label: 'HTTPS tool calls', field: 'hasHttpsToolCalls' as const },
      { id: 'hasReadEnoent', label: 'Read ENOENT', field: 'hasReadEnoent' as const },
      { id: 'hasErrConnectionRefused', label: 'ERR_CONNECTION_REFUSED', field: 'hasErrConnectionRefused' as const },
      { id: 'hasChromeWebdata', label: 'chromewebdata', field: 'hasChromeWebdata' as const },
    ];

    const rows: Array<{
      experiment: string;
      flag: string;
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
          rows.push({ experiment, flag: flag.label, rate: null, total, usable: 0, count: 0 });
          continue;
        }
        const count = usable.filter(Boolean).length;
        const rate = count / usable.length;
        rows.push({ experiment, flag: flag.label, rate, total, usable: usable.length, count });
      }
    }

    const palette = ['#fff5f0', '#fee0d2', '#fcbba1', '#fc9272', '#fb6a4a', '#cb181d'];
    const steps = palette.length;
    const cells = rows.map((d) => {
      const fill = d.rate === null ? ctx.theme.colors.grid : palette[Math.min(steps - 1, Math.floor(d.rate * steps))];
      const text = d.rate === null ? 'n/a' : fmtPct(d.rate);
      const textFill = isDark(fill) ? '#ffffff' : ctx.theme.colors.ink;
      return { ...d, fill, text, textFill };
    });

    const layout = resolveLayout(
      ctx.theme,
      {
        height: Math.max(220, 64 + flags.length * 26),
        marginLeft: marginLeftForLabels(
          flags.map((f) => f.label),
          ctx.theme,
          { min: 140, max: 320 },
        ),
        marginRight: 24,
        marginTop: 24,
        marginBottom: 48,
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
        x: { domain: ctx.experimentDomain, tickRotate: -20, tickSize: 0, label: null },
        y: { domain: flags.map((f) => f.label), tickSize: 0, label: null },
        color: { type: 'identity' },
        marks: [
          Plot.cell(cells, {
            x: 'experiment',
            y: 'flag',
            fill: 'fill',
            inset: 1,
            title: (d) => {
              if (d.rate === null) return `${d.experiment} × ${d.flag}\nRate: n/a (0/${d.total} runs report flag)`;
              const missing = Math.max(0, d.total - d.usable);
              return `${d.experiment} × ${d.flag}\nRate: ${fmtPct(d.rate)} (${d.count}/${d.usable}${missing ? `; ${missing} missing` : ''})`;
            },
          }),
          Plot.text(cells, {
            x: 'experiment',
            y: 'flag',
            text: 'text',
            fill: 'textFill',
            fontSize: 11,
            textAnchor: 'middle',
            dy: 3,
          }),
          Plot.frame({ stroke: ctx.theme.colors.grid }),
        ],
      }),
    });

    return { id: flagsHeatmapChart.id, title: flagsHeatmapChart.title, caption: flagsHeatmapChart.caption, svg };
  },
};
