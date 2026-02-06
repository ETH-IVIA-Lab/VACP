import * as Plot from '@observablehq/plot';
import { plotSvg, type SvgLegend } from './plot.js';
import { marginLeftForLabels, resolveLayout, tickStep } from './utils.js';
import type { ArenaChart, ArenaFigureLayout } from './types.js';
import type { NormalizedRun } from '../stats.js';
import {
  buildFailureSnippet,
  buildTrajectorySnippet,
  classifySolvedEvidence,
  pushUniqueBounded,
} from './solved-evidence.js';

export type ScenarioSolvedSemanticHeatmapChartConfig = ArenaFigureLayout;

type SolvedOutcomeBucket = 'solved-interaction' | 'solved-workaround' | 'failed' | 'unknown' | 'not-run';

function scenarioSolvedSemanticCells(
  ctx: Parameters<ArenaChart<ScenarioSolvedSemanticHeatmapChartConfig>['getData']>[0],
) {
  const scenarioIndex = new Map<string, number>();
  for (const [i, id] of ctx.scenarioDomain.entries()) scenarioIndex.set(id, i + 1);

  const byKey = aggregateSolvedSemanticOutcomes(ctx.runs);

  const cells = [];
  for (const experiment of ctx.experimentDomain) {
    for (const scenarioId of ctx.scenarioDomain) {
      const key = `${experiment}__${scenarioId}`;
      const d = byKey.get(key) ?? {
        experiment,
        scenarioId,
        total: 0,
        usable: 0,
        solvedInteraction: 0,
        solvedWorkaround: 0,
        failed: 0,
        basisSelfReportedInteraction: 0,
        basisSelfReportedPriorKnowledge: 0,
        basisInferredVacpExecute: 0,
        basisUnknown: 0,
        trajectoryNotes: [] as string[],
        failureNotes: [] as string[],
      };
      const bucket = classifySolvedBucket(d);
      const fill = bucketColor(bucket, ctx.theme);
      cells.push({
        experiment,
        scenario_id: scenarioId,
        scenario_index: scenarioIndex.get(scenarioId) ?? null,
        total: d.total,
        usable: d.usable,
        solved_interaction: d.solvedInteraction,
        solved_workaround: d.solvedWorkaround,
        failed: d.failed,
        basis_self_reported_interaction: d.basisSelfReportedInteraction,
        basis_self_reported_prior_knowledge: d.basisSelfReportedPriorKnowledge,
        basis_inferred_vacp_execute: d.basisInferredVacpExecute,
        basis_unknown: d.basisUnknown,
        trajectory_notes: d.trajectoryNotes,
        failure_notes: d.failureNotes,
        bucket,
        fill,
      });
    }
  }

  return cells;
}

export const scenarioSolvedSemanticHeatmapChart: ArenaChart<ScenarioSolvedSemanticHeatmapChartConfig> = {
  id: 'scenario-heatmap-semantic',
  title: 'Scenario by Experiment — Solved Semantic',
  caption:
    'Semantic result per task. Workaround detection uses reflection provenance first, with vacp_execute as fallback evidence when provenance is missing. Hover a cell for trajectory notes.',
  isApplicable: (ctx) => ctx.runs.some((r) => typeof r.solvedSemantic === 'boolean'),
  getData: (ctx) => scenarioSolvedSemanticCells(ctx),
  render: (ctx, config) => {
    const legend: SvgLegend = {
      items: [
        { label: 'Solved (interaction-derived)', fill: ctx.theme.colors.ok },
        { label: 'Solved (workaround / loophole)', fill: ctx.theme.colors.warn },
        { label: 'Failed', fill: ctx.theme.colors.bad },
        { label: 'n/a', fill: ctx.theme.colors.grid },
        { label: 'Not run', fill: '#ffffff', stroke: ctx.theme.colors.grid },
      ],
    };

    const scenarioIndex = new Map<string, number>();
    for (const [i, id] of ctx.scenarioDomain.entries()) scenarioIndex.set(id, i + 1);

    const labelEvery = tickStep(ctx.scenarioDomain.length);
    const cells = scenarioSolvedSemanticCells(ctx);

    const layout = resolveLayout(
      ctx.theme,
      {
        height: Math.max(220, 36 + ctx.experimentDomain.length * 26),
        marginLeft: marginLeftForLabels(ctx.experimentDomain, ctx.theme, { min: 140, max: 320 }),
        marginRight: 24,
        marginTop: 16,
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
        y: { domain: ctx.experimentDomain, tickSize: 0, label: null },
        color: { type: 'identity' },
        marks: [
          Plot.cell(cells, {
            x: 'scenario_id',
            y: 'experiment',
            fill: 'fill',
            inset: 0,
            title: (d) => formatSolvedSemanticCellTitle(d),
          }),
        ],
      }),
    });

    return {
      id: scenarioSolvedSemanticHeatmapChart.id,
      title: scenarioSolvedSemanticHeatmapChart.title,
      caption: scenarioSolvedSemanticHeatmapChart.caption,
      svg,
      data: cells,
    };
  },
};

function aggregateSolvedSemanticOutcomes(runs: NormalizedRun[]) {
  const byKey = new Map<
    string,
    {
      experiment: string;
      scenarioId: string;
      total: number;
      usable: number;
      solvedInteraction: number;
      solvedWorkaround: number;
      failed: number;
      basisSelfReportedInteraction: number;
      basisSelfReportedPriorKnowledge: number;
      basisInferredVacpExecute: number;
      basisUnknown: number;
      trajectoryNotes: string[];
      failureNotes: string[];
    }
  >();

  for (const run of runs) {
    if (!run.experiment || !run.scenarioId) continue;
    const key = `${run.experiment}__${run.scenarioId}`;
    const cur = byKey.get(key) ?? {
      experiment: run.experiment,
      scenarioId: run.scenarioId,
      total: 0,
      usable: 0,
      solvedInteraction: 0,
      solvedWorkaround: 0,
      failed: 0,
      basisSelfReportedInteraction: 0,
      basisSelfReportedPriorKnowledge: 0,
      basisInferredVacpExecute: 0,
      basisUnknown: 0,
      trajectoryNotes: [],
      failureNotes: [],
    };

    cur.total += 1;

    if (typeof run.solvedSemantic === 'boolean') {
      cur.usable += 1;
      if (run.solvedSemantic) {
        const evidence = classifySolvedEvidence(run);
        if (evidence.classification === 'interaction') cur.solvedInteraction += 1;
        else cur.solvedWorkaround += 1;

        if (evidence.basis === 'self-reported interaction-derived') cur.basisSelfReportedInteraction += 1;
        else if (evidence.basis === 'self-reported prior-knowledge/guess') cur.basisSelfReportedPriorKnowledge += 1;
        else if (evidence.basis === 'inferred interaction from vacp_execute') cur.basisInferredVacpExecute += 1;
        else cur.basisUnknown += 1;

        pushUniqueBounded(cur.trajectoryNotes, buildTrajectorySnippet(run), 3);
      } else {
        cur.failed += 1;
        pushUniqueBounded(cur.failureNotes, buildFailureSnippet(run), 2);
      }
    }

    byKey.set(key, cur);
  }

  return byKey;
}

function classifySolvedBucket(row: {
  total: number;
  solvedInteraction: number;
  solvedWorkaround: number;
  failed: number;
}): SolvedOutcomeBucket {
  if (row.total === 0) return 'not-run';
  if (row.solvedWorkaround > 0) return 'solved-workaround';
  if (row.solvedInteraction > 0) return 'solved-interaction';
  if (row.failed > 0) return 'failed';
  return 'unknown';
}

function bucketColor(
  bucket: SolvedOutcomeBucket,
  theme: { colors: { ok: string; warn: string; bad: string; grid: string } },
) {
  if (bucket === 'solved-interaction') return theme.colors.ok;
  if (bucket === 'solved-workaround') return theme.colors.warn;
  if (bucket === 'failed') return theme.colors.bad;
  if (bucket === 'unknown') return theme.colors.grid;
  return '#ffffff';
}

function formatSolvedSemanticCellTitle(row: {
  experiment: string;
  scenario_id: string;
  total: number;
  usable: number;
  solved_interaction: number;
  solved_workaround: number;
  failed: number;
  basis_self_reported_interaction: number;
  basis_self_reported_prior_knowledge: number;
  basis_inferred_vacp_execute: number;
  basis_unknown: number;
  trajectory_notes: string[];
  failure_notes: string[];
  bucket: SolvedOutcomeBucket;
}) {
  if (row.bucket === 'not-run') return `${row.experiment} × ${row.scenario_id}\nNot run`;
  if (row.bucket === 'unknown')
    return `${row.experiment} × ${row.scenario_id}\nSolved semantic: n/a (no usable solved_semantic value)`;

  const verdict =
    row.bucket === 'solved-interaction'
      ? 'Solved (interaction-derived)'
      : row.bucket === 'solved-workaround'
        ? 'Solved (workaround / loophole)'
        : 'Failed';
  return [
    `${row.experiment} × ${row.scenario_id}`,
    `Outcome: ${verdict}`,
    `Runs: total ${row.total}, usable ${row.usable}`,
    `Solved (interaction-derived): ${row.solved_interaction}`,
    `Solved (workaround / loophole): ${row.solved_workaround}`,
    `Failed: ${row.failed}`,
    `Evidence basis:`,
    `- Self-reported interaction-derived: ${row.basis_self_reported_interaction}`,
    `- Self-reported prior-knowledge/guess: ${row.basis_self_reported_prior_knowledge}`,
    `- Inferred interaction from vacp_execute: ${row.basis_inferred_vacp_execute}`,
    `- Unknown provenance: ${row.basis_unknown}`,
    ...(row.trajectory_notes.length
      ? ['Trajectory notes (sample):', ...row.trajectory_notes.map((note) => `- ${note}`)]
      : []),
    ...(row.failure_notes.length ? ['Failure notes (sample):', ...row.failure_notes.map((note) => `- ${note}`)] : []),
  ].join('\n');
}
