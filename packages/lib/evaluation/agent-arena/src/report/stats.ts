import type { ArenaRunRow, ArenaToolCallRow } from './load-analysis.js';
import { deriveEvalOutcome, isGradeable, isParseOk } from '../eval/outcome.js';

const CANONICAL_EXPERIMENT_ORDER = [
  'baseline',
  'with-snapshot',
  'pure-vacp',
  'plain-mcp',
  'partial-toolkit',
  'full-toolkit',
] as const;
const CANONICAL_EXPERIMENT_RANK = new Map<string, number>(
  CANONICAL_EXPERIMENT_ORDER.map((name, index) => [name, index] as const),
);

export type NormalizedRun = {
  runId: string | null;
  experiment: string;
  scenarioId: string;
  modelProvider: string;
  modelName: string;

  ok: boolean;
  // True when the run reached a stable, gradeable state with no detected infra or harness failure.
  // Archived analysis rows may only have `ok`, so use it as the plumbing fallback.
  plumbingOk: boolean | null;
  plumbingFailure: string | null;
  runErrorMessage: string | null;
  answerParseStatus: string | null;
  answerJson: unknown | null;
  answerJsonRaw: string | null;
  evalOutcome: string | null;

  durationS: number | null;
  costProviderUsd: number | null;
  costEstimatedUsd: number | null;
  costUsd: number | null;
  costBasis: string | null;
  tokensInput: number | null;
  tokensOutput: number | null;
  tokensReasoning: number | null;
  tokensCacheRead: number | null;
  tokensCacheWrite: number | null;
  tokensTotalNoCache: number | null;
  tokensTotalWithCacheRead: number | null;
  tokensTotalWithCacheAll: number | null;
  toolCalls: number | null;
  toolErrors: number | null;
  hasVacpExecuteTool: boolean | null;

  solvedStrict: boolean | null;
  solvedSemantic: boolean | null;

  hasHttpsToolCalls: boolean | null;
  hasReadEnoent: boolean | null;
  hasErrConnectionRefused: boolean | null;
  hasChromeWebdata: boolean | null;
};

export type ExperimentSummary = {
  experiment: string;
  n: number;
  okRate: number;
  plumbingOkRate: number | null;
  protocolOkRate: number | null;
  gradeableRate: number | null;
  solvedStrictRate: number | null;
  solvedSemanticRate: number | null;
  durationMedianS: number | null;
  costTotalUsd: number | null;
  costMedianUsd: number | null;
  tokensMedianNoCache: number | null;
  tokensMedianWithCacheRead: number | null;
  tokensMedianWithCacheAll: number | null;
  tokensMedianCacheRead: number | null;
  tokensMedianCacheWrite: number | null;
  tokensReadMultiplierMedian: number | null;
  tokensAllMultiplierMedian: number | null;
  toolCallsMean: number | null;
  toolErrorsMean: number | null;
};

export type ToolByExperimentRow = {
  experiment: string;
  tool: string;
  calls: number;
  errors: number;
  timedCalls: number;
  durationMs: number;
};

export type ToolByScenarioRow = {
  scenarioId: string;
  tool: string;
  calls: number;
  errors: number;
  timedCalls: number;
  durationMs: number;
};

export type ScenarioExperimentSummary = {
  scenarioId: string;
  experiment: string;
  n: number;
  okRate: number;
  plumbingOkRate: number | null;
  protocolOkRate: number | null;
  gradeableRate: number | null;
  solvedStrictRate: number | null;
  solvedSemanticRate: number | null;
  durationMedianS: number | null;
  costTotalUsd: number | null;
  costMedianUsd: number | null;
  tokensMedianNoCache: number | null;
  tokensMedianWithCacheRead: number | null;
  tokensMedianWithCacheAll: number | null;
  tokensMedianCacheRead: number | null;
  tokensMedianCacheWrite: number | null;
  toolCallsMean: number | null;
  toolErrorsMean: number | null;
};

export function normalizeRuns(rows: ArenaRunRow[]): NormalizedRun[] {
  const out: NormalizedRun[] = [];
  for (const row of rows) {
    const runId = asOptionalString((row as any).run_id);
    const experiment = asString(row.experiment);
    const scenarioId = asString((row as any).scenario_id);
    const modelProvider = asString((row as any).model_provider);
    const modelName = asString((row as any).model_name);

    const ok = asBoolean((row as any).ok) ?? false;
    const plumbingOk = asBoolean((row as any).plumbing_ok) ?? ok;
    const plumbingFailure = asOptionalString((row as any).plumbing_failure);
    const runErrorMessage = asOptionalString((row as any).run_error_message);
    const answerParseStatus = asOptionalString((row as any).answer_parse_status);
    const answerJson = ((row as any).answer_json as unknown) ?? null;
    const answerJsonRaw = asOptionalString((row as any).answer_json_raw);
    let evalOutcome = asOptionalString((row as any).eval_outcome);

    const durationMs = pickNumber((row as any).opencode_duration_ms, (row as any).duration_ms);
    const durationS = typeof durationMs === 'number' ? durationMs / 1000 : null;
    const costProviderUsd = asNumber((row as any).cost_provider_usd) ?? asNumber((row as any).cost);
    const costEstimatedUsd = asNumber((row as any).cost_estimated_usd);
    const costUsd =
      asNumber((row as any).cost_usd) ??
      (typeof costProviderUsd === 'number'
        ? costProviderUsd
        : typeof costEstimatedUsd === 'number'
          ? costEstimatedUsd
          : null);
    const costBasis =
      asOptionalString((row as any).cost_basis) ??
      (typeof costUsd === 'number' && typeof costProviderUsd === 'number' && costUsd === costProviderUsd
        ? 'provider_reported'
        : typeof costUsd === 'number' && typeof costEstimatedUsd === 'number' && costUsd === costEstimatedUsd
          ? 'model_pricing'
          : null);

    const tokensInput = asNumber((row as any).tokens_input);
    const tokensOutput = asNumber((row as any).tokens_output);
    const tokensReasoning = asNumber((row as any).tokens_reasoning);
    const tokensCacheRead = asNumber((row as any).tokens_cache_read);
    const tokensCacheWrite = asNumber((row as any).tokens_cache_write);

    const tokensTotalNoCache =
      asNumber((row as any).tokens_total_no_cache) ??
      sumNumbers((row as any).tokens_input, (row as any).tokens_output, (row as any).tokens_reasoning);
    const tokensTotalWithCacheRead =
      asNumber((row as any).tokens_total_with_cache) ??
      (typeof tokensTotalNoCache === 'number' ? tokensTotalNoCache + (tokensCacheRead ?? 0) : null);
    const tokensTotalWithCacheAll =
      typeof tokensTotalWithCacheRead === 'number'
        ? tokensTotalWithCacheRead + (tokensCacheWrite ?? 0)
        : typeof tokensTotalNoCache === 'number'
          ? tokensTotalNoCache + (tokensCacheRead ?? 0) + (tokensCacheWrite ?? 0)
          : null;

    const toolCalls = asNumber((row as any).tool_calls);
    const toolErrors = asNumber((row as any).tool_errors);
    const hasVacpExecuteTool = hasVacpExecuteSignal((row as any).tools_json);

    const solvedStrict = normalizeSolvedField(row, 'solved_strict', 'score_ok');
    const solvedSemantic = normalizeSolvedField(row, 'solved_semantic', null);

    if (!evalOutcome)
      evalOutcome = deriveEvalOutcome({ ok, plumbingOk, parseStatus: answerParseStatus, solvedStrict, solvedSemantic });

    out.push({
      runId,
      experiment,
      scenarioId,
      modelProvider,
      modelName,
      ok,
      plumbingOk,
      plumbingFailure,
      runErrorMessage,
      answerParseStatus,
      answerJson,
      answerJsonRaw,
      evalOutcome,
      durationS,
      costProviderUsd,
      costEstimatedUsd,
      costUsd,
      costBasis,
      tokensInput,
      tokensOutput,
      tokensReasoning,
      tokensCacheRead,
      tokensCacheWrite,
      tokensTotalNoCache,
      tokensTotalWithCacheRead,
      tokensTotalWithCacheAll,
      toolCalls,
      toolErrors,
      hasVacpExecuteTool,
      solvedStrict,
      solvedSemantic,
      hasHttpsToolCalls: asBoolean((row as any).has_https_tool_calls),
      hasReadEnoent: asBoolean((row as any).has_read_enoent),
      hasErrConnectionRefused: asBoolean((row as any).has_err_connection_refused),
      hasChromeWebdata: asBoolean((row as any).has_chrome_webdata),
    });
  }

  return out;
}

export function computeExperimentSummaries(runs: NormalizedRun[]): ExperimentSummary[] {
  const byExp = groupBy(runs, (r) => r.experiment);
  const out: ExperimentSummary[] = [];

  for (const [experiment, rows] of byExp) {
    const n = rows.length;
    const okRate = n ? rows.filter((r) => r.ok).length / n : 0;
    const plumbingOkRate = fraction(rows.map((r) => r.plumbingOk));
    const protocolOkRate = fraction(rows.map((r) => isParseOk(r.answerParseStatus)));
    const gradeableRate = fraction(rows.map((r) => isGradeableRow(r)));
    const solvedStrictRate = fraction(rows.map((r) => r.solvedStrict));
    const solvedSemanticRate = fraction(rows.map((r) => r.solvedSemantic));
    const durationMedianS = median(rows.flatMap((r) => (typeof r.durationS === 'number' ? [r.durationS] : [])));
    const costValues = rows.flatMap((r) => (typeof r.costUsd === 'number' ? [r.costUsd] : []));
    const costTotalUsd = sum(costValues);
    const costMedianUsd = median(costValues);
    const tokensMedianNoCache = median(
      rows.flatMap((r) => (typeof r.tokensTotalNoCache === 'number' ? [r.tokensTotalNoCache] : [])),
    );
    const tokensMedianWithCacheRead = median(
      rows.flatMap((r) => (typeof r.tokensTotalWithCacheRead === 'number' ? [r.tokensTotalWithCacheRead] : [])),
    );
    const tokensMedianWithCacheAll = median(
      rows.flatMap((r) => (typeof r.tokensTotalWithCacheAll === 'number' ? [r.tokensTotalWithCacheAll] : [])),
    );
    const tokensMedianCacheRead = median(
      rows.flatMap((r) => (typeof r.tokensCacheRead === 'number' ? [r.tokensCacheRead] : [])),
    );
    const tokensMedianCacheWrite = median(
      rows.flatMap((r) => (typeof r.tokensCacheWrite === 'number' ? [r.tokensCacheWrite] : [])),
    );
    const tokensReadMultiplierMedian =
      typeof tokensMedianNoCache === 'number' &&
      tokensMedianNoCache > 0 &&
      typeof tokensMedianWithCacheRead === 'number'
        ? tokensMedianWithCacheRead / tokensMedianNoCache
        : null;
    const tokensAllMultiplierMedian =
      typeof tokensMedianNoCache === 'number' && tokensMedianNoCache > 0 && typeof tokensMedianWithCacheAll === 'number'
        ? tokensMedianWithCacheAll / tokensMedianNoCache
        : null;
    const toolCallsMean = mean(rows.flatMap((r) => (typeof r.toolCalls === 'number' ? [r.toolCalls] : [])));
    const toolErrorsMean = mean(rows.flatMap((r) => (typeof r.toolErrors === 'number' ? [r.toolErrors] : [])));

    out.push({
      experiment,
      n,
      okRate,
      plumbingOkRate,
      protocolOkRate,
      gradeableRate,
      solvedStrictRate,
      solvedSemanticRate,
      durationMedianS,
      costTotalUsd,
      costMedianUsd,
      tokensMedianNoCache,
      tokensMedianWithCacheRead,
      tokensMedianWithCacheAll,
      tokensMedianCacheRead,
      tokensMedianCacheWrite,
      tokensReadMultiplierMedian,
      tokensAllMultiplierMedian,
      toolCallsMean,
      toolErrorsMean,
    });
  }

  out.sort((a, b) => compareExperimentNames(a.experiment, b.experiment));
  return out;
}

export function experimentDomainByMedianDuration(runs: NormalizedRun[]) {
  // Historical name retained for API stability.
  const names = Array.from(new Set(runs.map((r) => r.experiment).filter(Boolean)));
  names.sort(compareExperimentNames);
  return names;
}

export function scenarioDomain(runs: NormalizedRun[]) {
  const ids = Array.from(new Set(runs.map((r) => r.scenarioId).filter(Boolean)));
  ids.sort((a, b) => a.localeCompare(b));
  return ids;
}

export function summarizeToolCallsByExperiment(toolCalls: ArenaToolCallRow[]) {
  if (!toolCalls.length) return [];

  const byKey = new Map<string, ToolByExperimentRow>();
  for (const t of toolCalls) {
    const tool = asString((t as any).tool);
    if (!tool) continue;
    const experiment = asString((t as any).experiment);
    if (!experiment) continue;

    const key = `${experiment}__${tool}`;
    const status = asString((t as any).status);
    const durationMs = asNumber((t as any).duration_ms) ?? 0;

    const row =
      byKey.get(key) ??
      ({
        experiment,
        tool,
        calls: 0,
        errors: 0,
        timedCalls: 0,
        durationMs: 0,
      } satisfies ToolByExperimentRow);
    row.calls += 1;
    if (status === 'error') row.errors += 1;
    if (durationMs > 0) {
      row.timedCalls += 1;
      row.durationMs += durationMs;
    }
    byKey.set(key, row);
  }

  const out = Array.from(byKey.values());
  out.sort((a, b) => {
    if (a.experiment !== b.experiment) return compareExperimentNames(a.experiment, b.experiment);
    return a.tool.localeCompare(b.tool);
  });
  return out;
}

export function summarizeToolCallsByScenario(toolCalls: ArenaToolCallRow[]) {
  if (!toolCalls.length) return [];

  const byKey = new Map<string, ToolByScenarioRow>();
  for (const t of toolCalls) {
    const tool = asString((t as any).tool);
    if (!tool) continue;
    const scenarioId = asString((t as any).scenario_id) || asString((t as any).scenarioId);
    if (!scenarioId) continue;

    const key = `${scenarioId}__${tool}`;
    const status = asString((t as any).status);
    const durationMs = asNumber((t as any).duration_ms) ?? 0;

    const row =
      byKey.get(key) ??
      ({
        scenarioId,
        tool,
        calls: 0,
        errors: 0,
        timedCalls: 0,
        durationMs: 0,
      } satisfies ToolByScenarioRow);
    row.calls += 1;
    if (status === 'error') row.errors += 1;
    if (durationMs > 0) {
      row.timedCalls += 1;
      row.durationMs += durationMs;
    }
    byKey.set(key, row);
  }

  const out = Array.from(byKey.values());
  out.sort((a, b) => {
    if (a.scenarioId !== b.scenarioId) return a.scenarioId.localeCompare(b.scenarioId);
    return a.tool.localeCompare(b.tool);
  });
  return out;
}

export function computeScenarioExperimentSummaries(runs: NormalizedRun[]): ScenarioExperimentSummary[] {
  const byKey = groupBy(runs, (r) => `${r.scenarioId}__${r.experiment}`);
  const out: ScenarioExperimentSummary[] = [];

  for (const [key, rows] of byKey) {
    const [scenarioId, experiment] = key.split('__');
    const n = rows.length;
    const okRate = n ? rows.filter((r) => r.ok).length / n : 0;
    const plumbingOkRate = fraction(rows.map((r) => r.plumbingOk));
    const protocolOkRate = fraction(rows.map((r) => isParseOk(r.answerParseStatus)));
    const gradeableRate = fraction(rows.map((r) => isGradeableRow(r)));
    const solvedStrictRate = fraction(rows.map((r) => r.solvedStrict));
    const solvedSemanticRate = fraction(rows.map((r) => r.solvedSemantic));
    const durationMedianS = median(rows.flatMap((r) => (typeof r.durationS === 'number' ? [r.durationS] : [])));
    const costValues = rows.flatMap((r) => (typeof r.costUsd === 'number' ? [r.costUsd] : []));
    const costTotalUsd = sum(costValues);
    const costMedianUsd = median(costValues);
    const tokensMedianNoCache = median(
      rows.flatMap((r) => (typeof r.tokensTotalNoCache === 'number' ? [r.tokensTotalNoCache] : [])),
    );
    const tokensMedianWithCacheRead = median(
      rows.flatMap((r) => (typeof r.tokensTotalWithCacheRead === 'number' ? [r.tokensTotalWithCacheRead] : [])),
    );
    const tokensMedianWithCacheAll = median(
      rows.flatMap((r) => (typeof r.tokensTotalWithCacheAll === 'number' ? [r.tokensTotalWithCacheAll] : [])),
    );
    const tokensMedianCacheRead = median(
      rows.flatMap((r) => (typeof r.tokensCacheRead === 'number' ? [r.tokensCacheRead] : [])),
    );
    const tokensMedianCacheWrite = median(
      rows.flatMap((r) => (typeof r.tokensCacheWrite === 'number' ? [r.tokensCacheWrite] : [])),
    );
    const toolCallsMean = mean(rows.flatMap((r) => (typeof r.toolCalls === 'number' ? [r.toolCalls] : [])));
    const toolErrorsMean = mean(rows.flatMap((r) => (typeof r.toolErrors === 'number' ? [r.toolErrors] : [])));

    out.push({
      scenarioId: scenarioId ?? '',
      experiment: experiment ?? '',
      n,
      okRate,
      plumbingOkRate,
      protocolOkRate,
      gradeableRate,
      solvedStrictRate,
      solvedSemanticRate,
      durationMedianS,
      costTotalUsd,
      costMedianUsd,
      tokensMedianNoCache,
      tokensMedianWithCacheRead,
      tokensMedianWithCacheAll,
      tokensMedianCacheRead,
      tokensMedianCacheWrite,
      toolCallsMean,
      toolErrorsMean,
    });
  }

  out.sort((a, b) => {
    if (a.scenarioId !== b.scenarioId) return a.scenarioId.localeCompare(b.scenarioId);
    return compareExperimentNames(a.experiment, b.experiment);
  });
  return out;
}

function compareExperimentNames(a: string, b: string) {
  const ia = CANONICAL_EXPERIMENT_RANK.get(a);
  const ib = CANONICAL_EXPERIMENT_RANK.get(b);
  if (typeof ia === 'number' && typeof ib === 'number') return ia - ib;
  if (typeof ia === 'number') return -1;
  if (typeof ib === 'number') return 1;
  return a.localeCompare(b);
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function asOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function hasVacpExecuteSignal(value: unknown): boolean | null {
  const names = extractToolNames(value);
  if (!names) return null;
  return names.some((name) => /(?:^|[_/.-])vacp_execute(?:$|[_/.-])/i.test(name));
}

function extractToolNames(value: unknown): string[] | null {
  if (!value) return null;

  if (Array.isArray(value)) {
    const names: string[] = [];
    for (const item of value) {
      if (typeof item === 'string' && item.trim()) names.push(item.trim());
      else if (item && typeof item === 'object') {
        const tool = asOptionalString((item as any).tool) ?? asOptionalString((item as any).name);
        if (tool) names.push(tool);
      }
    }
    return names.length ? names : null;
  }

  if (typeof value === 'object') {
    const names = Object.keys(value as Record<string, unknown>).filter((k) => k.trim());
    return names.length ? names : null;
  }

  return null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function normalizeSolvedField(row: ArenaRunRow, primaryKey: string, fallbackKey: string | null) {
  if (Object.prototype.hasOwnProperty.call(row, primaryKey)) return asBoolean((row as any)[primaryKey]);
  if (fallbackKey && Object.prototype.hasOwnProperty.call(row, fallbackKey))
    return asBoolean((row as any)[fallbackKey]);
  return null;
}

function isGradeableRow(run: NormalizedRun) {
  return isGradeable({
    plumbingOk: run.plumbingOk,
    parseStatus: run.answerParseStatus,
    solvedStrict: run.solvedStrict,
    solvedSemantic: run.solvedSemantic,
  });
}

function pickNumber(...values: unknown[]) {
  for (const v of values) {
    const n = asNumber(v);
    if (typeof n === 'number') return n;
  }
  return null;
}

function sumNumbers(...values: unknown[]) {
  let sum = 0;
  let found = false;
  for (const v of values) {
    const n = asNumber(v);
    if (typeof n !== 'number') continue;
    sum += n;
    found = true;
  }
  return found ? sum : null;
}

function mean(values: number[]) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function sum(values: number[]) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0);
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function fraction(values: Array<boolean | null>) {
  const usable = values.filter((v): v is boolean => typeof v === 'boolean');
  if (!usable.length) return null;
  return usable.filter(Boolean).length / usable.length;
}

function groupBy<T, K>(rows: T[], key: (row: T) => K) {
  const out = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}
