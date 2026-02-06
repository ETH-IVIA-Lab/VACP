import fs from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { DEFAULT_CHARTS, createChartContext, type ArenaAnyChart, type ArenaReportTheme } from './charts.js';
import { prepareArenaAnalysis } from './prepare.js';
import type {
  ExperimentSummary,
  NormalizedRun,
  ScenarioExperimentSummary,
  ToolByExperimentRow,
  ToolByScenarioRow,
} from './stats.js';

export type ExportArenaDatasetsArgs = {
  analysisDir: string;
  outDir?: string;
  charts?: ArenaAnyChart[];
  chartConfigById?: Record<string, unknown>;
  theme?: Partial<ArenaReportTheme>;
};

export async function exportArenaDatasets(args: ExportArenaDatasetsArgs) {
  const analysisDir = path.resolve(args.analysisDir);
  const outDir = path.resolve(args.outDir ?? path.join(analysisDir, 'datasets'));

  const prepared = await prepareArenaAnalysis({ analysisDir });

  const document = new JSDOM('').window.document;
  const ctx = createChartContext({
    document,
    theme: args.theme,
    runs: prepared.runs,
    summaries: prepared.summaries,
    toolByExperiment: prepared.toolByExperiment,
    toolByScenario: prepared.toolByScenario,
    experimentDomain: prepared.experimentDomain,
    scenarioDomain: prepared.scenarioDomain,
  });

  const charts = args.charts ?? DEFAULT_CHARTS;
  const chartDatasets: Array<{ id: string; title: string; caption: string; rows: unknown[] }> = [];
  for (const chart of charts) {
    if (chart.isApplicable && !chart.isApplicable(ctx)) continue;
    const cfg = args.chartConfigById?.[chart.id] as any;
    const rowsRaw = chart.getData(ctx, cfg);
    const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
    chartDatasets.push({ id: chart.id, title: chart.title, caption: chart.caption, rows });
  }

  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  const chartsDir = path.join(outDir, 'charts');
  await fs.mkdir(chartsDir, { recursive: true });

  await writeJson(path.join(outDir, 'meta.json'), {
    generated_at: new Date().toISOString(),
    analysis_dir: analysisDir,
    run_id: typeof prepared.meta?.runId === 'string' ? prepared.meta.runId : null,
    scenario_defs_path: prepared.scenarioDefsPath,
    charts: chartDatasets.map((c) => ({
      id: c.id,
      title: c.title,
      caption: c.caption,
      rows: c.rows.length,
      path: `charts/${c.id}.json`,
    })),
  });

  await writeJson(path.join(outDir, 'domains.json'), {
    experiment_domain: prepared.experimentDomain,
    scenario_domain: prepared.scenarioDomain,
  });

  await writeJson(path.join(outDir, 'runs_normalized.json'), exportNormalizedRuns(prepared.runs));
  await writeJson(path.join(outDir, 'experiment_summaries.json'), exportExperimentSummaries(prepared.summaries));
  await writeJson(path.join(outDir, 'task_summaries.json'), exportTaskSummaries(prepared.taskSummaries));
  await writeJson(path.join(outDir, 'tool_by_experiment.json'), exportToolByExperiment(prepared.toolByExperiment));
  await writeJson(path.join(outDir, 'tool_by_scenario.json'), exportToolByScenario(prepared.toolByScenario));
  await writeJson(path.join(outDir, 'task_index.json'), exportTaskIndex(prepared.taskIndex));

  for (const ds of chartDatasets) {
    await writeJson(path.join(chartsDir, `${ds.id}.json`), ds.rows);
  }

  return {
    analysisDir,
    outDir,
    chartsDir,
    chartIds: chartDatasets.map((d) => d.id),
  };
}

function exportNormalizedRuns(runs: NormalizedRun[]) {
  return runs.map((r) => ({
    experiment: r.experiment,
    scenario_id: r.scenarioId,
    model_provider: r.modelProvider,
    model_name: r.modelName,
    ok: r.ok,
    plumbing_ok: r.plumbingOk,
    plumbing_failure: r.plumbingFailure,
    answer_parse_status: r.answerParseStatus,
    reflection_structured_parse_status: r.reflectionStructuredParseStatus,
    reflection_structured_json: r.reflectionStructuredJson,
    reflection_structured_raw: r.reflectionStructuredRaw,
    reflection_provenance: r.reflectionProvenance,
    reflection_confidence: r.reflectionConfidence,
    reflection_robustness: r.reflectionRobustness,
    reflection_easy_hard_why: r.reflectionEasyHardWhy,
    reflection_actions_tools_available_vs_used_why: r.reflectionActionsToolsAvailableVsUsedWhy,
    eval_outcome: r.evalOutcome,
    duration_s: r.durationS,
    tokens_total_no_cache: r.tokensTotalNoCache,
    tool_calls: r.toolCalls,
    tool_errors: r.toolErrors,
    solved_strict: r.solvedStrict,
    solved_semantic: r.solvedSemantic,
    has_https_tool_calls: r.hasHttpsToolCalls,
    has_read_enoent: r.hasReadEnoent,
    has_err_connection_refused: r.hasErrConnectionRefused,
    has_chrome_webdata: r.hasChromeWebdata,
  }));
}

function exportExperimentSummaries(summaries: ExperimentSummary[]) {
  return summaries.map((s) => ({
    experiment: s.experiment,
    n: s.n,
    ok_rate: s.okRate,
    plumbing_ok_rate: s.plumbingOkRate,
    protocol_ok_rate: s.protocolOkRate,
    gradeable_rate: s.gradeableRate,
    solved_strict_rate: s.solvedStrictRate,
    solved_semantic_rate: s.solvedSemanticRate,
    duration_s_median: s.durationMedianS,
    tokens_total_no_cache_median: s.tokensMedianNoCache,
    tool_calls_mean: s.toolCallsMean,
    tool_errors_mean: s.toolErrorsMean,
  }));
}

function exportTaskSummaries(summaries: ScenarioExperimentSummary[]) {
  return summaries.map((s) => ({
    scenario_id: s.scenarioId,
    experiment: s.experiment,
    n: s.n,
    ok_rate: s.okRate,
    plumbing_ok_rate: s.plumbingOkRate,
    protocol_ok_rate: s.protocolOkRate,
    gradeable_rate: s.gradeableRate,
    solved_strict_rate: s.solvedStrictRate,
    solved_semantic_rate: s.solvedSemanticRate,
    duration_s_median: s.durationMedianS,
    tokens_total_no_cache_median: s.tokensMedianNoCache,
    tool_calls_mean: s.toolCallsMean,
    tool_errors_mean: s.toolErrorsMean,
  }));
}

function exportToolByExperiment(rows: ToolByExperimentRow[]) {
  return rows.map((r) => ({
    experiment: r.experiment,
    tool: r.tool,
    calls: r.calls,
    errors: r.errors,
    timed_calls: r.timedCalls,
    duration_ms: r.durationMs,
  }));
}

function exportToolByScenario(rows: ToolByScenarioRow[]) {
  return rows.map((r) => ({
    scenario_id: r.scenarioId,
    tool: r.tool,
    calls: r.calls,
    errors: r.errors,
    timed_calls: r.timedCalls,
    duration_ms: r.durationMs,
  }));
}

function exportTaskIndex(
  rows: Array<{
    index: number;
    scenarioId: string;
    app: string | null;
    tags: string[];
    task: string | null;
    responseFormat: string | null;
  }>,
) {
  return rows.map((row) => ({
    index: row.index,
    scenario_id: row.scenarioId,
    app: row.app,
    tags: row.tags,
    task: row.task,
    response_format: row.responseFormat,
  }));
}

async function writeJson(filePath: string, value: unknown) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}
