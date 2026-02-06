import { loadArenaAnalysis, type ArenaAnalysisMeta, type ArenaRunRow, type ArenaToolCallRow } from './load-analysis.js';
import { loadScenarioDefs, type ScenarioDef } from './load-scenarios.js';
import {
  computeExperimentSummaries,
  computeScenarioExperimentSummaries,
  experimentDomainByMedianDuration,
  normalizeRuns,
  scenarioDomain,
  summarizeToolCallsByExperiment,
  summarizeToolCallsByScenario,
  type ExperimentSummary,
  type NormalizedRun,
  type ScenarioExperimentSummary,
  type ToolByExperimentRow,
  type ToolByScenarioRow,
} from './stats.js';

export type PreparedArenaAnalysis = {
  analysisDir: string;
  meta: ArenaAnalysisMeta | null;
  runs: NormalizedRun[];
  experimentDomain: string[];
  scenarioDomain: string[];
  summaries: ExperimentSummary[];
  toolByExperiment: ToolByExperimentRow[];
  toolByScenario: ToolByScenarioRow[];
  taskSummaries: ScenarioExperimentSummary[];
  taskIndex: Array<{
    index: number;
    scenarioId: string;
    app: string | null;
    tags: string[];
    task: string | null;
    responseFormat: string | null;
  }>;
  scenarioDefsPath: string | null;
};

export async function prepareArenaAnalysis(args: {
  analysisDir: string;
  filter?: { modelProvider: string; modelName: string };
}): Promise<PreparedArenaAnalysis> {
  const analysis = await loadArenaAnalysis(args.analysisDir);
  const runsRawFiltered = args.filter ? filterByModel(analysis.runs, args.filter) : analysis.runs;
  const toolCallsRawFiltered = args.filter ? filterByModel(analysis.toolCalls, args.filter) : analysis.toolCalls;
  const selectedRuns = selectPreferredRuns(runsRawFiltered);
  const runsRaw = selectedRuns.rows;
  const toolCallsRaw = filterToolCallsBySelectedRuns(toolCallsRawFiltered, selectedRuns.sessionsByGroup);

  const runs = normalizeRuns(runsRaw);
  const experimentDomain = experimentDomainByMedianDuration(runs);
  const rawScenarioIds = scenarioDomain(runs);
  const summaries = computeExperimentSummaries(runs);
  const toolByExperiment = summarizeToolCallsByExperiment(toolCallsRaw);
  const toolByScenario = summarizeToolCallsByScenario(toolCallsRaw);
  const taskSummaries = computeScenarioExperimentSummaries(runs);

  const loadedScenarioDefs = await loadScenarioDefs(analysis.meta);
  const scenarioDefs = loadedScenarioDefs?.defs ?? null;
  const scenarioDefsPath = loadedScenarioDefs?.sourcePath ?? null;
  const scenarioDefById = new Map<string, ScenarioDef>((scenarioDefs ?? []).map((d) => [d.id, d] as const));

  const orderedScenarioIds = orderScenarioIds(rawScenarioIds, scenarioDefs);
  const taskIndex = orderedScenarioIds.map((id, i) =>
    makeTaskIndexEntry({ index: i + 1, scenarioId: id, def: scenarioDefById.get(id) ?? null }),
  );

  return {
    analysisDir: analysis.analysisDir,
    meta: analysis.meta,
    runs,
    experimentDomain,
    scenarioDomain: orderedScenarioIds,
    summaries,
    toolByExperiment,
    toolByScenario,
    taskSummaries,
    taskIndex,
    scenarioDefsPath,
  };
}

function filterByModel<T extends Record<string, unknown>>(
  rows: T[],
  filter: { modelProvider: string; modelName: string },
): T[] {
  return rows.filter((row) => matchesModel(row, filter));
}

function selectPreferredRuns(rows: ArenaRunRow[]): {
  rows: ArenaRunRow[];
  sessionsByGroup: Map<string, Set<string>>;
} {
  const byGroup = new Map<string, ArenaRunRow[]>();
  for (const row of rows) {
    const key = runGroupKey(row);
    const list = byGroup.get(key);
    if (list) list.push(row);
    else byGroup.set(key, [row]);
  }

  const out: ArenaRunRow[] = [];
  const sessionsByGroup = new Map<string, Set<string>>();
  for (const [groupKey, groupRows] of byGroup) {
    const chosen = [...groupRows].sort(compareRunPriority)[0];
    if (!chosen) continue;
    out.push(chosen);
    const sessionId = asOptionalString((chosen as any).session_id) ?? '';
    sessionsByGroup.set(groupKey, new Set([sessionId]));
  }

  return { rows: out, sessionsByGroup };
}

function filterToolCallsBySelectedRuns(
  rows: ArenaToolCallRow[],
  sessionsByGroup: Map<string, Set<string>>,
): ArenaToolCallRow[] {
  if (!rows.length || !sessionsByGroup.size) return rows;
  return rows.filter((row) => {
    const sessions = sessionsByGroup.get(toolCallGroupKey(row));
    if (!sessions || !sessions.size) return false;

    const sessionId = asOptionalString((row as any).session_id);
    if (sessionId) return sessions.has(sessionId) || sessions.has('');
    return sessions.has('') || sessions.size === 1;
  });
}

function runGroupKey(row: Record<string, unknown>) {
  const scenarioId = asString((row as any).scenario_id ?? (row as any).scenarioId);
  return [
    asString((row as any).model_provider),
    asString((row as any).model_name),
    asString((row as any).run_id),
    asString((row as any).experiment),
    scenarioId,
  ].join('__');
}

function toolCallGroupKey(row: Record<string, unknown>) {
  const scenarioId = asString((row as any).scenario_id ?? (row as any).scenarioId);
  return [
    asString((row as any).model_provider),
    asString((row as any).model_name),
    asString((row as any).run_id),
    asString((row as any).experiment),
    scenarioId,
  ].join('__');
}

function compareRunPriority(a: ArenaRunRow, b: ArenaRunRow) {
  const pa = runPriority(a);
  const pb = runPriority(b);
  for (let i = 0; i < pa.length; i += 1) {
    const delta = pb[i] - pa[i];
    if (delta !== 0) return delta;
  }

  const sa = asString((a as any).session_id);
  const sb = asString((b as any).session_id);
  return sb.localeCompare(sa);
}

function runPriority(row: ArenaRunRow) {
  const plumbingOk = asBoolean((row as any).plumbing_ok);
  const ok = asBoolean((row as any).ok);
  const parseStatus = asOptionalString((row as any).answer_parse_status);
  const solvedSemantic = asBoolean((row as any).solved_semantic);
  const solvedStrict = asBoolean((row as any).solved_strict) ?? asBoolean((row as any).score_ok);
  const finishedAtMs = parseTime((row as any).finished_at);
  const startedAtMs = parseTime((row as any).started_at);

  const plumbingScore = plumbingOk === true ? 2 : plumbingOk === false ? 0 : ok === true ? 1 : 0;
  const okScore = ok === true ? 1 : 0;
  const parseScore = parseStatus === 'ok' ? 1 : 0;
  const semanticScore = solvedSemantic === true ? 2 : solvedSemantic === false ? 1 : 0;
  const strictScore = solvedStrict === true ? 2 : solvedStrict === false ? 1 : 0;
  const recencyScore = Number.isFinite(finishedAtMs)
    ? finishedAtMs
    : Number.isFinite(startedAtMs)
      ? startedAtMs
      : Number.NEGATIVE_INFINITY;

  return [plumbingScore, okScore, parseScore, semanticScore, strictScore, recencyScore];
}

function matchesModel(row: Record<string, unknown>, filter: { modelProvider: string; modelName: string }) {
  const provider = asString((row as any).model_provider);
  const name = asString((row as any).model_name);
  return provider === filter.modelProvider && name === filter.modelName;
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function asOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function parseTime(value: unknown) {
  if (typeof value !== 'string') return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

function orderScenarioIds(ids: string[], defs: ScenarioDef[] | null) {
  const order = new Map<string, number>();
  if (defs) for (const [i, d] of defs.entries()) order.set(d.id, i);
  const sorted = [...ids];
  sorted.sort((a, b) => {
    const ia = order.get(a);
    const ib = order.get(b);
    if (typeof ia === 'number' && typeof ib === 'number') return ia - ib;
    if (typeof ia === 'number') return -1;
    if (typeof ib === 'number') return 1;
    return a.localeCompare(b);
  });
  return sorted;
}

function makeTaskIndexEntry(args: { index: number; scenarioId: string; def: ScenarioDef | null }) {
  const app = args.def ? formatApp(args.def) : null;
  return {
    index: args.index,
    scenarioId: args.scenarioId,
    app,
    tags: args.def?.tags ?? [],
    task: args.def?.task ?? null,
    responseFormat: args.def?.responseFormat ?? null,
  };
}

function formatApp(def: ScenarioDef) {
  if (!def.hash) return def.route || 'n/a';
  return `${def.route}#${def.hash}`;
}
