import { loadArenaAnalysis, type ArenaAnalysisMeta } from './load-analysis.js';
import { loadScenarioDefs, type ScenarioDef } from './load-scenarios.js';
import {
  computeExperimentSummaries,
  computeScenarioExperimentSummaries,
  experimentDomainByMedianDuration,
  normalizeRuns,
  scenarioDomain,
  summarizeToolCallsByExperiment,
  type ExperimentSummary,
  type NormalizedRun,
  type ScenarioExperimentSummary,
  type ToolByExperimentRow,
} from './stats.js';

export type PreparedArenaAnalysis = {
  analysisDir: string;
  meta: ArenaAnalysisMeta | null;
  runs: NormalizedRun[];
  experimentDomain: string[];
  scenarioDomain: string[];
  summaries: ExperimentSummary[];
  toolByExperiment: ToolByExperimentRow[];
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
  const runsRaw = args.filter ? filterByModel(analysis.runs, args.filter) : analysis.runs;
  const toolCallsRaw = args.filter ? filterByModel(analysis.toolCalls, args.filter) : analysis.toolCalls;

  const runs = normalizeRuns(runsRaw);
  const experimentDomain = experimentDomainByMedianDuration(runs);
  const rawScenarioIds = scenarioDomain(runs);
  const summaries = computeExperimentSummaries(runs);
  const toolByExperiment = summarizeToolCallsByExperiment(toolCallsRaw);
  const taskSummaries = computeScenarioExperimentSummaries(runs);

  const loadedScenarioDefs = await loadScenarioDefs(analysis.meta);
  const scenarioDefs = loadedScenarioDefs?.defs ?? null;
  const scenarioDefsPath = loadedScenarioDefs?.sourcePath ?? null;
  const scenarioDefById = new Map<string, ScenarioDef>((scenarioDefs ?? []).map((d) => [d.id, d] as const));

  const orderedScenarioIds = orderScenarioIds(rawScenarioIds, scenarioDefs);
  const taskIndex = orderedScenarioIds.map((id, i) => makeTaskIndexEntry({ index: i + 1, scenarioId: id, def: scenarioDefById.get(id) ?? null }));

  return {
    analysisDir: analysis.analysisDir,
    meta: analysis.meta,
    runs,
    experimentDomain,
    scenarioDomain: orderedScenarioIds,
    summaries,
    toolByExperiment,
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

function matchesModel(
  row: Record<string, unknown>,
  filter: { modelProvider: string; modelName: string },
) {
  const provider = typeof (row as any).model_provider === 'string' ? String((row as any).model_provider) : '';
  const name = typeof (row as any).model_name === 'string' ? String((row as any).model_name) : '';
  return provider === filter.modelProvider && name === filter.modelName;
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
