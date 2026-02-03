import type { ArenaRunRow, ArenaToolCallRow } from './load-analysis.js';
import { deriveEvalOutcome, isGradeable, isParseOk } from '../eval/outcome.js';

export type NormalizedRun = {
  experiment: string;
  scenarioId: string;
  modelProvider: string;
  modelName: string;

  ok: boolean;
  // True when the run reached a stable, gradeable state (no infra/harness failures detected).
  // Older analysis folders won't have this field; fall back to `ok`.
  plumbingOk: boolean | null;
  plumbingFailure: string | null;
  answerParseStatus: string | null;
  evalOutcome: string | null;

  durationS: number | null;
  tokensTotalNoCache: number | null;
  toolCalls: number | null;
  toolErrors: number | null;

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
  tokensMedianNoCache: number | null;
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
  tokensMedianNoCache: number | null;
  toolCallsMean: number | null;
  toolErrorsMean: number | null;
};

export function normalizeRuns(rows: ArenaRunRow[]): NormalizedRun[] {
  const out: NormalizedRun[] = [];
  for (const row of rows) {
    const experiment = asString(row.experiment);
    const scenarioId = asString((row as any).scenario_id);
    const modelProvider = asString((row as any).model_provider);
    const modelName = asString((row as any).model_name);

    const ok = asBoolean((row as any).ok) ?? false;
    const plumbingOk = asBoolean((row as any).plumbing_ok) ?? ok;
    const plumbingFailure = asOptionalString((row as any).plumbing_failure);
    const answerParseStatus = asOptionalString((row as any).answer_parse_status);
    let evalOutcome = asOptionalString((row as any).eval_outcome);

    const durationMs = pickNumber((row as any).opencode_duration_ms, (row as any).duration_ms);
    const durationS = typeof durationMs === 'number' ? durationMs / 1000 : null;

    const tokensTotalNoCache =
      asNumber((row as any).tokens_total_no_cache) ??
      sumNumbers((row as any).tokens_input, (row as any).tokens_output, (row as any).tokens_reasoning);

    const toolCalls = asNumber((row as any).tool_calls);
    const toolErrors = asNumber((row as any).tool_errors);

    const solvedStrict = normalizeSolvedField(row, 'solved_strict', 'score_ok');
    const solvedSemantic = normalizeSolvedField(row, 'solved_semantic', null);

    if (!evalOutcome)
      evalOutcome = deriveEvalOutcome({ ok, plumbingOk, parseStatus: answerParseStatus, solvedStrict, solvedSemantic });

    out.push({
      experiment,
      scenarioId,
      modelProvider,
      modelName,
      ok,
      plumbingOk,
      plumbingFailure,
      answerParseStatus,
      evalOutcome,
      durationS,
      tokensTotalNoCache,
      toolCalls,
      toolErrors,
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
    const tokensMedianNoCache = median(
      rows.flatMap((r) => (typeof r.tokensTotalNoCache === 'number' ? [r.tokensTotalNoCache] : [])),
    );
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
      tokensMedianNoCache,
      toolCallsMean,
      toolErrorsMean,
    });
  }

  out.sort((a, b) => a.experiment.localeCompare(b.experiment));
  return out;
}

export function experimentDomainByMedianDuration(runs: NormalizedRun[]) {
  const summaries = computeExperimentSummaries(runs);
  summaries.sort((a, b) => {
    const da = a.durationMedianS ?? Number.POSITIVE_INFINITY;
    const db = b.durationMedianS ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return a.experiment.localeCompare(b.experiment);
  });
  return summaries.map((s) => s.experiment);
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
    if (a.experiment !== b.experiment) return a.experiment.localeCompare(b.experiment);
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
    const tokensMedianNoCache = median(
      rows.flatMap((r) => (typeof r.tokensTotalNoCache === 'number' ? [r.tokensTotalNoCache] : [])),
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
      tokensMedianNoCache,
      toolCallsMean,
      toolErrorsMean,
    });
  }

  out.sort((a, b) => {
    if (a.scenarioId !== b.scenarioId) return a.scenarioId.localeCompare(b.scenarioId);
    return a.experiment.localeCompare(b.experiment);
  });
  return out;
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
