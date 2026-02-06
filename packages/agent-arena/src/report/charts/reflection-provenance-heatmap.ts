import * as Plot from '@observablehq/plot';
import { plotSvg, type SvgLegend } from './plot.js';
import { fmtPct, isDark, marginLeftForLabels, resolveLayout, tickStep } from './utils.js';
import type { ArenaChart, ArenaFigureLayout } from './types.js';
import type { NormalizedRun } from '../stats.js';

export type ReflectionProvenanceHeatmapChartConfig = ArenaFigureLayout;

function reflectionProvenanceCells(
  ctx: Parameters<ArenaChart<ReflectionProvenanceHeatmapChartConfig>['getData']>[0],
) {
  const scenarioIndex = new Map<string, number>();
  for (const [i, id] of ctx.scenarioDomain.entries()) scenarioIndex.set(id, i + 1);

  const byKey = aggregateReflectionProvenance(ctx.runs);

  const cells = [];
  for (const experiment of ctx.experimentDomain) {
    for (const scenarioId of ctx.scenarioDomain) {
      const key = `${experiment}__${scenarioId}`;
      const d = byKey.get(key) ?? {
        experiment,
        scenarioId,
        total: 0,
        parsed: 0,
        interactionDerived: 0,
        priorKnowledgeGuess: 0,
      };
      const interactionRate = d.parsed ? d.interactionDerived / d.parsed : null;
      const priorRate = d.parsed ? d.priorKnowledgeGuess / d.parsed : null;
      const missing = Math.max(0, d.total - d.parsed);
      const bucket =
        d.total === 0
          ? 'not-run'
          : d.parsed === 0
            ? 'unknown'
            : interactionRate === 1
              ? 'interaction-only'
              : interactionRate === 0
                ? 'prior-only'
                : 'mixed';
      const fill = bucketColor(bucket, ctx.theme);
      const label = bucket === 'not-run' ? '' : interactionRate === null ? 'n/a' : String(Math.round(interactionRate * 100));
      const text_fill = isDark(fill) ? '#ffffff' : ctx.theme.colors.ink;
      cells.push({
        experiment,
        scenario_id: scenarioId,
        scenario_index: scenarioIndex.get(scenarioId) ?? null,
        total: d.total,
        parsed: d.parsed,
        interaction_derived: d.interactionDerived,
        prior_knowledge_guess: d.priorKnowledgeGuess,
        missing,
        interaction_derived_rate: interactionRate,
        prior_knowledge_guess_rate: priorRate,
        bucket,
        fill,
        label,
        text_fill,
      });
    }
  }

  return cells;
}

export const reflectionProvenanceHeatmapChart: ArenaChart<ReflectionProvenanceHeatmapChartConfig> = {
  id: 'reflection-provenance-heatmap',
  title: 'Task × Experiment (Interaction-Derived Provenance Rate)',
  caption:
    'Heatmap of `interaction-derived` reflection provenance rates per task. X-axis labels are task indices (see “Task Index” table).',
  isApplicable: (ctx) => ctx.runs.some((r) => !!r.reflectionProvenance),
  getData: (ctx) => reflectionProvenanceCells(ctx),
  render: (ctx, config) => {
    const legend: SvgLegend = {
      items: [
        { label: '100% interaction-derived', fill: ctx.theme.colors.ok },
        { label: '0% interaction-derived (all prior/guess)', fill: ctx.theme.colors.bad },
        { label: 'Mixed', fill: ctx.theme.colors.neutral },
        { label: 'n/a', fill: ctx.theme.colors.grid },
        { label: 'Not run', fill: '#ffffff', stroke: ctx.theme.colors.grid },
      ],
    };

    const scenarioIndex = new Map<string, number>();
    for (const [i, id] of ctx.scenarioDomain.entries()) scenarioIndex.set(id, i + 1);

    const labelEvery = tickStep(ctx.scenarioDomain.length);
    const cells = reflectionProvenanceCells(ctx);

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
            inset: 1,
            title: (d) => formatCellTitle(d),
          }),
          Plot.text(cells, {
            x: 'scenario_id',
            y: 'experiment',
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
      id: reflectionProvenanceHeatmapChart.id,
      title: reflectionProvenanceHeatmapChart.title,
      caption: reflectionProvenanceHeatmapChart.caption,
      svg,
      data: cells,
    };
  },
};

function aggregateReflectionProvenance(runs: NormalizedRun[]) {
  const byKey = new Map<
    string,
    {
      experiment: string;
      scenarioId: string;
      total: number;
      parsed: number;
      interactionDerived: number;
      priorKnowledgeGuess: number;
    }
  >();

  for (const run of runs) {
    if (!run.experiment || !run.scenarioId) continue;
    const key = `${run.experiment}__${run.scenarioId}`;
    const cur = byKey.get(key) ?? {
      experiment: run.experiment,
      scenarioId: run.scenarioId,
      total: 0,
      parsed: 0,
      interactionDerived: 0,
      priorKnowledgeGuess: 0,
    };
    cur.total += 1;
    if (run.reflectionProvenance === 'interaction-derived' || run.reflectionProvenance === 'prior-knowledge/guess') {
      cur.parsed += 1;
      if (run.reflectionProvenance === 'interaction-derived') cur.interactionDerived += 1;
      if (run.reflectionProvenance === 'prior-knowledge/guess') cur.priorKnowledgeGuess += 1;
    }
    byKey.set(key, cur);
  }

  return byKey;
}

function bucketColor(bucket: string, theme: { colors: { ok: string; bad: string; grid: string; neutral: string } }) {
  if (bucket === 'interaction-only') return theme.colors.ok;
  if (bucket === 'prior-only') return theme.colors.bad;
  if (bucket === 'unknown') return theme.colors.grid;
  if (bucket === 'not-run') return '#ffffff';
  return theme.colors.neutral;
}

function formatCellTitle(row: {
  experiment: string;
  scenario_id: string;
  total: number;
  parsed: number;
  interaction_derived: number;
  prior_knowledge_guess: number;
  interaction_derived_rate: number | null;
  missing: number;
  bucket: string;
}) {
  if (row.bucket === 'not-run') return `${row.experiment} × ${row.scenario_id}\nNot run`;
  if (row.interaction_derived_rate === null)
    return `${row.experiment} × ${row.scenario_id}\nInteraction-derived: n/a (no structured reflection parsed)`;

  const missingSuffix = row.missing ? `; ${row.missing} missing` : '';
  return [
    `${row.experiment} × ${row.scenario_id}`,
    `Interaction-derived: ${fmtPct(row.interaction_derived_rate)} (${row.interaction_derived}/${row.parsed}${missingSuffix})`,
    `Prior-knowledge/guess: ${row.prior_knowledge_guess}/${row.parsed}`,
  ].join('\n');
}
