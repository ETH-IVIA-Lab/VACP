import * as Plot from '@observablehq/plot';
import { plotSvg, type SvgLegend } from './plot.js';
import { fmtPct, percentTick, resolveLayout } from './utils.js';
import type { ArenaChart, ArenaFigureLayout } from './types.js';
import type { NormalizedRun } from '../stats.js';

export type SolvedStrictChartConfig = ArenaFigureLayout;

function solvedStrictRows(ctx: Parameters<ArenaChart<SolvedStrictChartConfig>['getData']>[0]) {
  const byExp = countSolved(ctx.runs, (r) => r.solvedStrict);
  return ctx.experimentDomain.map((experiment) => {
    const counts = byExp.get(experiment) ?? { total: 0, usable: 0, solved: 0 };
    const rate = counts.usable ? counts.solved / counts.usable : null;
    return {
      experiment,
      solved_strict_rate: rate,
      solved_strict_rate_display: rate ?? 0,
      ...counts,
    };
  });
}

export const solvedStrictChart: ArenaChart<SolvedStrictChartConfig> = {
  id: 'solved-strict',
  title: 'Solved Rate (Strict)',
  caption: 'Per-experiment strict solved rate (from `solved_strict` when present).',
  isApplicable: (ctx) => ctx.runs.some((r) => typeof r.solvedStrict === 'boolean'),
  getData: (ctx) => solvedStrictRows(ctx),
  render: (ctx, config) => {
    const data = solvedStrictRows(ctx);
    const legend: SvgLegend = {
      items: [
        { label: 'Solved rate available', fill: ctx.theme.colors.ok },
        { label: 'Solved rate missing', fill: ctx.theme.colors.grid },
      ],
    };

    const layout = resolveLayout(
      ctx.theme,
      { height: 220, marginLeft: 56, marginRight: 24, marginTop: 24, marginBottom: 56 },
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
        x: { domain: ctx.experimentDomain, label: null, tickRotate: -20 },
        y: { domain: [0, 1], grid: true, label: 'Solved rate (strict)', tickFormat: percentTick },
        marks: [
          Plot.barY(data, {
            x: 'experiment',
            y: 'solved_strict_rate_display',
            fill: (d) => (d.solved_strict_rate === null ? ctx.theme.colors.grid : ctx.theme.colors.ok),
            title: (d) => {
              const missing = Math.max(0, d.total - d.usable);
              if (d.solved_strict_rate === null)
                return `${d.experiment}\nSolved (strict): n/a (0/${d.total} runs report solved_strict)`;
              return [
                d.experiment,
                `n=${d.total}`,
                `Solved (strict): ${fmtPct(d.solved_strict_rate)} (${d.solved}/${d.usable}${missing ? `; ${missing} missing` : ''})`,
              ].join('\n');
            },
          }),
          Plot.ruleY([0]),
          Plot.text(data, {
            x: 'experiment',
            y: 'solved_strict_rate_display',
            text: (d) => (d.solved_strict_rate === null ? 'n/a' : fmtPct(d.solved_strict_rate)),
            dy: -8,
            fill: ctx.theme.colors.ink,
            fontSize: 10,
            textAnchor: 'middle',
          }),
        ],
      }),
    });

    return { id: 'solved-strict', title: 'Solved Rate (Strict)', caption: solvedStrictChart.caption, svg, data };
  },
};

function countSolved(runs: NormalizedRun[], get: (run: NormalizedRun) => boolean | null) {
  const byExp = new Map<string, { total: number; usable: number; solved: number }>();
  for (const r of runs) {
    const exp = r.experiment;
    if (!exp) continue;
    const cur = byExp.get(exp) ?? { total: 0, usable: 0, solved: 0 };
    cur.total += 1;
    const v = get(r);
    if (typeof v === 'boolean') {
      cur.usable += 1;
      if (v) cur.solved += 1;
    }
    byExp.set(exp, cur);
  }
  return byExp;
}
