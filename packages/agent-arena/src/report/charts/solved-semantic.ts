import * as Plot from '@observablehq/plot';
import { plotSvg } from './plot.js';
import { fmtPct, percentTick, resolveLayout } from './utils.js';
import type { ArenaChart, ArenaFigureLayout } from './types.js';
import type { NormalizedRun } from '../stats.js';

export type SolvedSemanticChartConfig = ArenaFigureLayout;

export const solvedSemanticChart: ArenaChart<SolvedSemanticChartConfig> = {
  id: 'solved-semantic',
  title: 'Solved Rate (Semantic)',
  caption: 'Per-experiment semantic solved rate (from `solved_semantic` when present).',
  isApplicable: (ctx) => ctx.runs.some((r) => typeof r.solvedSemantic === 'boolean'),
  render: (ctx, config) => {
    const byExp = countSolved(ctx.runs, (r) => r.solvedSemantic);
    const data = ctx.experimentDomain.map((experiment) => {
      const counts = byExp.get(experiment) ?? { total: 0, usable: 0, solved: 0 };
      const rate = counts.usable ? counts.solved / counts.usable : null;
      return {
        experiment,
        rate,
        displayRate: rate ?? 0,
        ...counts,
      };
    });

    const layout = resolveLayout(
      ctx.theme,
      { height: 220, marginLeft: 56, marginRight: 24, marginTop: 24, marginBottom: 56 },
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
        x: { domain: ctx.experimentDomain, label: null, tickRotate: -20 },
        y: { domain: [0, 1], grid: true, label: 'Solved rate (semantic)', tickFormat: percentTick },
        marks: [
          Plot.barY(data, {
            x: 'experiment',
            y: 'displayRate',
            fill: (d) => (d.rate === null ? ctx.theme.colors.grid : ctx.theme.colors.neutral),
            title: (d) => {
              const missing = Math.max(0, d.total - d.usable);
              if (d.rate === null)
                return `${d.experiment}\nSolved (semantic): n/a (0/${d.total} runs report solved_semantic)`;
              return [
                d.experiment,
                `n=${d.total}`,
                `Solved (semantic): ${fmtPct(d.rate)} (${d.solved}/${d.usable}${missing ? `; ${missing} missing` : ''})`,
              ].join('\n');
            },
          }),
          Plot.ruleY([0]),
          Plot.text(data, {
            x: 'experiment',
            y: 'displayRate',
            text: (d) => (d.rate === null ? 'n/a' : fmtPct(d.rate)),
            dy: -8,
            fill: ctx.theme.colors.ink,
            fontSize: 10,
            textAnchor: 'middle',
          }),
        ],
      }),
    });

    return { id: solvedSemanticChart.id, title: solvedSemanticChart.title, caption: solvedSemanticChart.caption, svg };
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
