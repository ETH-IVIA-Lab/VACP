import * as Plot from '@observablehq/plot';
import { plotSvg } from './plot.js';
import { fmtPct, resolveLayout } from './utils.js';
import type { ArenaChart, ArenaFigureLayout } from './types.js';
import { deriveEvalOutcome } from '../../eval/outcome.js';

export type EvalOutcomesChartConfig = ArenaFigureLayout;

type OutcomeSpec = { id: string; label: string; color: string };

function outcomeDomain(theme: {
  colors: { ok: string; warn: string; bad: string; info: string; grid: string; neutral: string; subtle: string };
}): OutcomeSpec[] {
  return [
    { id: 'plumbing_failure', label: 'Plumbing failure', color: theme.colors.grid },
    { id: 'protocol_failure', label: 'Protocol failure', color: theme.colors.warn },
    { id: 'eval_error', label: 'Eval error', color: theme.colors.neutral },
    { id: 'unscored', label: 'Unscored', color: theme.colors.subtle },
    { id: 'semantic_failure', label: 'Semantic failure', color: theme.colors.bad },
    { id: 'solved_semantic', label: 'Solved semantic', color: theme.colors.ok },
    { id: 'solved_strict', label: 'Solved strict', color: theme.colors.ok },
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

function evalOutcomeRows(ctx: Parameters<ArenaChart<EvalOutcomesChartConfig>['getData']>[0]) {
  const specs = outcomeDomain(ctx.theme);
  const specById = new Map<string, OutcomeSpec>(specs.map((s) => [s.id, s] as const));

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
    const counts = new Map<string, number>();
    for (const r of expRuns) {
      const key = resolveOutcome(r);
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

    // Preserve any unknown categories we didn't anticipate.
    for (const [outcome, count] of counts) {
      if (specById.has(outcome)) continue;
      rows.push({
        experiment,
        outcome,
        outcome_label: outcome,
        count,
        total,
        rate: total ? count / total : 0,
      });
    }
  }

  return rows;
}

export const evalOutcomesChart: ArenaChart<EvalOutcomesChartConfig> = {
  id: 'eval-outcomes',
  title: 'Outcome Breakdown by Experiment',
  caption: 'How runs end in each experiment: solved, semantic miss, parse/protocol miss, infra issue, or unscored.',
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
