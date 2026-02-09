import * as Plot from '@observablehq/plot';
import { plotSvg } from './plot.js';
import { fmtPct, resolveLayout } from './utils.js';
import type { ArenaChart, ArenaFigureLayout } from './types.js';
import { deriveEvalOutcome } from '../../eval/outcome.js';

export type EvalOutcomesChartConfig = ArenaFigureLayout;

type OutcomeBucketId = 'correct_solution' | 'incorrect_solution' | 'timeout';
type OutcomeSpec = { id: OutcomeBucketId; label: string; color: string };

function outcomeDomain(theme: {
  colors: { ok: string; warn: string; bad: string; info: string; grid: string; neutral: string; subtle: string };
}): OutcomeSpec[] {
  return [
    { id: 'correct_solution', label: 'Correct Solution', color: theme.colors.ok },
    { id: 'incorrect_solution', label: 'Incorrect Solution', color: theme.colors.bad },
    { id: 'timeout', label: 'Timeout', color: theme.colors.grid },
  ];
}

function resolveOutcome(run: {
  ok: boolean;
  plumbingOk: boolean | null;
  answerParseStatus: string | null;
  solvedStrict: boolean | null;
  solvedSemantic: boolean | null;
  evalOutcome: string | null;
}) {
  const provided = typeof run.evalOutcome === 'string' ? run.evalOutcome.trim() : '';
  if (provided) return provided;
  return deriveEvalOutcome({
    ok: run.ok,
    plumbingOk: run.plumbingOk,
    parseStatus: run.answerParseStatus,
    solvedStrict: run.solvedStrict,
    solvedSemantic: run.solvedSemantic,
  });
}

function resolveOutcomeBucket(run: {
  ok: boolean;
  plumbingOk: boolean | null;
  answerParseStatus: string | null;
  solvedStrict: boolean | null;
  solvedSemantic: boolean | null;
  evalOutcome: string | null;
}): OutcomeBucketId {
  const outcome = resolveOutcome(run);
  if (outcome === 'plumbing_failure') return 'timeout';
  if (run.solvedSemantic === true || outcome === 'solved_semantic' || outcome === 'solved_strict') {
    return 'correct_solution';
  }
  return 'incorrect_solution';
}

function evalOutcomeRows(ctx: Parameters<ArenaChart<EvalOutcomesChartConfig>['getData']>[0]) {
  const specs = outcomeDomain(ctx.theme);

  const rows: Array<{
    experiment: string;
    outcome: string;
    outcome_label: string;
    count: number;
    total: number;
    rate: number;
  }> = [];

  for (const experiment of ctx.experimentDomain) {
    const expRuns = ctx.runs.filter((r) => r.experiment === experiment);
    const total = expRuns.length;
    const counts = new Map<OutcomeBucketId, number>();
    for (const r of expRuns) {
      const key = resolveOutcomeBucket(r);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const spec of specs) {
      const count = counts.get(spec.id) ?? 0;
      const rate = total ? count / total : 0;
      rows.push({
        experiment,
        outcome: spec.id,
        outcome_label: spec.label,
        count,
        total,
        rate,
      });
    }
  }

  return rows;
}

export const evalOutcomesChart: ArenaChart<EvalOutcomesChartConfig> = {
  id: 'eval-outcomes',
  title: 'Outcome Breakdown by Experiment',
  caption: 'How runs end in each experiment: timeout, correct solution (semantic), or incorrect solution.',
  isApplicable: (ctx) => ctx.runs.length > 0,
  getData: (ctx) => evalOutcomeRows(ctx),
  render: (ctx, config) => {
    const data = evalOutcomeRows(ctx);
    const specs = outcomeDomain(ctx.theme);

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
        y: { grid: true, label: 'Runs' },
        color: {
          domain: specs.map((s) => s.label),
          range: specs.map((s) => s.color),
          legend: true,
        },
        marks: [
          Plot.barY(
            data,
            Plot.stackY({
              x: 'experiment',
              y: 'count',
              fill: 'outcome_label',
              title: (d) => `${d.experiment}\n${d.outcome_label}: ${d.count}/${d.total} (${fmtPct(d.rate)})`,
            }),
          ),
          Plot.ruleY([0]),
        ],
      }),
    });

    return { id: evalOutcomesChart.id, title: evalOutcomesChart.title, caption: evalOutcomesChart.caption, svg, data };
  },
};
