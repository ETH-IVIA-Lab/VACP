import fs from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import {
  buildDefaultFigures,
  createTheme,
  DEFAULT_THEME,
  type ArenaAnyChart,
  type ArenaReportTheme,
} from './charts.js';
import { loadArenaAnalysis } from './load-analysis.js';
import { loadScenarioDefs, type ScenarioDef } from './load-scenarios.js';
import { renderArenaReportHtml, type ArenaReportSection } from './render-html.js';
import {
  computeExperimentSummaries,
  computeScenarioExperimentSummaries,
  experimentDomainByMedianDuration,
  normalizeRuns,
  scenarioDomain,
  summarizeToolCallsByExperiment,
} from './stats.js';

export type GenerateArenaReportArgs = {
  analysisDir: string;
  outDir?: string;
  theme?: Partial<ArenaReportTheme>;
  charts?: ArenaAnyChart[];
  chartConfigById?: Record<string, unknown>;
  sections?: ArenaReportSection[];
};

export type GenerateArenaReportDeps = {
  fs: Pick<typeof fs, 'mkdir' | 'rm' | 'writeFile'>;
  createDocument: () => Document;
};

const DEFAULT_DEPS: GenerateArenaReportDeps = {
  fs,
  createDocument: () => new JSDOM('').window.document,
};

export async function generateArenaReport(args: GenerateArenaReportArgs, deps: GenerateArenaReportDeps = DEFAULT_DEPS) {
  const analysisDir = path.resolve(args.analysisDir);
  const outDir = path.resolve(args.outDir ?? path.join(analysisDir, 'report'));

  const analysis = await loadArenaAnalysis(analysisDir);
  const runs = normalizeRuns(analysis.runs);

  const experimentDomain = experimentDomainByMedianDuration(runs);
  const rawScenarioIds = scenarioDomain(runs);
  const summaries = computeExperimentSummaries(runs);
  const toolByExperiment = summarizeToolCallsByExperiment(analysis.toolCalls);
  const taskSummaries = computeScenarioExperimentSummaries(runs);

  const loadedScenarioDefs = await loadScenarioDefs(analysis.meta);
  const scenarioDefById = new Map<string, ScenarioDef>((loadedScenarioDefs?.defs ?? []).map((d) => [d.id, d] as const));
  const scenarioIds = orderScenarioIds(rawScenarioIds, loadedScenarioDefs?.defs ?? null);
  const taskIndex = scenarioIds.map((id, i) =>
    makeTaskIndexEntry({ index: i + 1, scenarioId: id, def: scenarioDefById.get(id) ?? null }),
  );
  const document = deps.createDocument();

  const theme = args.theme ? createTheme(args.theme) : DEFAULT_THEME;

  const figures = buildDefaultFigures({
    document,
    runs,
    summaries,
    toolByExperiment,
    experimentDomain,
    scenarioDomain: scenarioIds,
    theme,
    charts: args.charts,
    chartConfigById: args.chartConfigById,
  });

  await deps.fs.mkdir(outDir, { recursive: true });
  const figuresDir = path.join(outDir, 'figures');
  await deps.fs.rm(figuresDir, { recursive: true, force: true });
  await deps.fs.mkdir(figuresDir, { recursive: true });

  for (const f of figures) {
    const svgPath = path.join(figuresDir, `${f.id}.svg`);
    await deps.fs.writeFile(svgPath, f.svg, 'utf8');
  }

  const htmlPath = path.join(outDir, 'index.html');
  await deps.fs.writeFile(
    htmlPath,
    renderArenaReportHtml(
      {
        analysisDir,
        summaries,
        figures,
        runId: typeof analysis.meta?.runId === 'string' ? analysis.meta.runId : null,
        generatedAt: typeof analysis.meta?.generatedAt === 'string' ? analysis.meta.generatedAt : null,
        taskIndex,
        experiments: experimentDomain,
        taskSummaries,
        scenarioDefsPath: loadedScenarioDefs?.sourcePath ?? null,
        figureWidthPx: theme.width,
      },
      args.sections,
    ),
    'utf8',
  );

  return { analysisDir, outDir, htmlPath, figuresDir, figures };
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
