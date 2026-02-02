import * as Plot from '@observablehq/plot';
import { plotSvg } from './plot.js';
import { fmtPct, isDark, marginLeftForLabels, resolveLayout, tickStep } from './utils.js';
import type { ArenaChart, ArenaFigureLayout } from './types.js';
import type { NormalizedRun } from '../stats.js';

export type ScenarioSolvedHeatmapChartConfig = ArenaFigureLayout;

function scenarioSolvedCells(ctx: Parameters<ArenaChart<ScenarioSolvedHeatmapChartConfig>['getData']>[0]) {
  const scenarioIndex = new Map<string, number>();
  for (const [i, id] of ctx.scenarioDomain.entries()) scenarioIndex.set(id, i + 1);

  const byKey = aggregateSolvedRate(ctx.runs);

  const cells = [];
  for (const experiment of ctx.experimentDomain) {
    for (const scenarioId of ctx.scenarioDomain) {
      const key = `${experiment}__${scenarioId}`;
      const d = byKey.get(key) ?? { experiment, scenarioId, total: 0, usable: 0, solved: 0 };
      const rate = d.usable ? d.solved / d.usable : null;
      const missing = d.total - d.usable;
      const bucket =
        d.total === 0
          ? 'not-run'
          : rate === null
            ? 'unknown'
            : rate === 1
              ? 'solved'
              : rate === 0
                ? 'unsolved'
                : 'mixed';
      const fill = bucketColor(bucket, ctx.theme);
      const label = bucket === 'not-run' ? '' : rate === null ? 'n/a' : String(Math.round(rate * 100));
      const text_fill = isDark(fill) ? '#ffffff' : ctx.theme.colors.ink;
      cells.push({
        experiment,
        scenario_id: scenarioId,
        scenario_index: scenarioIndex.get(scenarioId) ?? null,
        total: d.total,
        usable: d.usable,
        solved: d.solved,
        missing,
        solved_strict_rate: rate,
        bucket,
        fill,
        label,
        text_fill,
      });
    }
  }

  return cells;
}

export const scenarioSolvedHeatmapChart: ArenaChart<ScenarioSolvedHeatmapChartConfig> = {
  id: 'scenario-heatmap',
  title: 'Scenario × Experiment (Solved Strict)',
  caption: 'Heatmap of strict solved rate per task. X-axis labels are task indices (see “Task Index” table).',
  isApplicable: (ctx) => ctx.runs.some((r) => typeof r.solvedStrict === 'boolean'),
  getData: (ctx) => scenarioSolvedCells(ctx),
  render: (ctx, config) => {
    const scenarioIndex = new Map<string, number>();
    for (const [i, id] of ctx.scenarioDomain.entries()) scenarioIndex.set(id, i + 1);

    const labelEvery = tickStep(ctx.scenarioDomain.length);
    const cells = scenarioSolvedCells(ctx);

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
            title: (d) => formatSolvedCellTitle(d),
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
      id: scenarioSolvedHeatmapChart.id,
      title: scenarioSolvedHeatmapChart.title,
      caption: scenarioSolvedHeatmapChart.caption,
      svg,
      data: cells,
    };
  },
};

function aggregateSolvedRate(runs: NormalizedRun[]) {
  const byKey = new Map<
    string,
    { experiment: string; scenarioId: string; total: number; usable: number; solved: number }
  >();
  for (const r of runs) {
    if (!r.experiment || !r.scenarioId) continue;
    const key = `${r.experiment}__${r.scenarioId}`;
    const cur = byKey.get(key) ?? {
      experiment: r.experiment,
      scenarioId: r.scenarioId,
      total: 0,
      usable: 0,
      solved: 0,
    };
    cur.total += 1;
    if (typeof r.solvedStrict === 'boolean') {
      cur.usable += 1;
      if (r.solvedStrict) cur.solved += 1;
    }
    byKey.set(key, cur);
  }
  return byKey;
}

function bucketColor(bucket: string, theme: { colors: { ok: string; bad: string; grid: string; neutral: string } }) {
  if (bucket === 'solved') return theme.colors.ok;
  if (bucket === 'unsolved') return theme.colors.bad;
  if (bucket === 'unknown') return theme.colors.grid;
  if (bucket === 'not-run') return '#ffffff';
  return theme.colors.neutral;
}

function formatSolvedCellTitle(row: {
  experiment: string;
  scenario_id: string;
  solved_strict_rate: number | null;
  total: number;
  usable: number;
  solved: number;
  missing: number;
  bucket: string;
}) {
  if (row.bucket === 'not-run') return `${row.experiment} × ${row.scenario_id}\nNot run`;
  if (row.solved_strict_rate === null)
    return `${row.experiment} × ${row.scenario_id}\nSolved (strict): n/a (0/${row.total} runs report solved_strict)`;

  const missingSuffix = row.missing ? `; ${row.missing} missing` : '';
  return `${row.experiment} × ${row.scenario_id}\nSolved (strict): ${fmtPct(row.solved_strict_rate)} (${row.solved}/${row.usable}${missingSuffix})`;
}
