import fs from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { buildDefaultFigures, DEFAULT_THEME, type ArenaAnyChart, type ArenaReportTheme } from './charts.js';
import type { ArenaAnalysisInput } from './load-analysis.js';
import { prepareArenaAnalysis } from './prepare.js';
import { renderArenaReportHtml, type ArenaReportSection } from './render-html.js';

export type GenerateArenaReportArgs = {
  analysisDir: ArenaAnalysisInput;
  outDir?: string;
  theme?: Partial<ArenaReportTheme>;
  charts?: ArenaAnyChart[];
  chartConfigById?: Record<string, unknown>;
  sections?: ArenaReportSection[];
  filter?: {
    modelProvider: string;
    modelName: string;
  };
  modelLabel?: string;
  indexHref?: string;
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
  const prepared = await prepareArenaAnalysis({
    analysisDir: args.analysisDir,
    ...(args.filter ? { filter: args.filter } : {}),
  });

  const analysisDir = prepared.analysisDir;
  const outDir = path.resolve(args.outDir ?? path.join(analysisDir, 'report'));
  const document = deps.createDocument();

  const figures = buildDefaultFigures({
    document,
    runs: prepared.runs,
    summaries: prepared.summaries,
    toolByExperiment: prepared.toolByExperiment,
    toolByScenario: prepared.toolByScenario,
    experimentDomain: prepared.experimentDomain,
    scenarioDomain: prepared.scenarioDomain,
    theme: args.theme,
    charts: args.charts,
    chartConfigById: args.chartConfigById,
  });

  const figureWidthPx = typeof args.theme?.width === 'number' ? args.theme.width : DEFAULT_THEME.width;

  await deps.fs.mkdir(outDir, { recursive: true });
  const figuresDir = path.join(outDir, 'figures');
  await deps.fs.rm(figuresDir, { recursive: true, force: true });
  await deps.fs.mkdir(figuresDir, { recursive: true });

  const dataDir = path.join(outDir, 'data');
  await deps.fs.rm(dataDir, { recursive: true, force: true });
  await deps.fs.mkdir(dataDir, { recursive: true });

  for (const f of figures) {
    const svgPath = path.join(figuresDir, `${f.id}.svg`);
    await deps.fs.writeFile(svgPath, f.svg, 'utf8');

    const dataPath = path.join(dataDir, `${f.id}.json`);
    const rows = Array.isArray(f.data) ? (f.data as unknown[]) : [];
    await deps.fs.writeFile(dataPath, JSON.stringify(rows, null, 2) + '\n', 'utf8');
  }

  const htmlPath = path.join(outDir, 'index.html');
  await deps.fs.writeFile(
    htmlPath,
    renderArenaReportHtml(
      {
        analysisDir,
        runs: prepared.runs,
        summaries: prepared.summaries,
        figures,
        runId: typeof prepared.meta?.runId === 'string' ? prepared.meta.runId : null,
        generatedAt: typeof prepared.meta?.generatedAt === 'string' ? prepared.meta.generatedAt : null,
        analysisSources: prepared.analysisSources,
        modelLabel: args.modelLabel ?? null,
        indexHref: args.indexHref ?? null,
        taskIndex: prepared.taskIndex,
        experiments: prepared.experimentDomain,
        taskSummaries: prepared.taskSummaries,
        scenarioDefsPath: prepared.scenarioDefsPath,
        opencodeLogSource:
          typeof prepared.meta?.opencodeLogSource === 'string' ? prepared.meta.opencodeLogSource : null,
        opencodeExportManifest:
          typeof prepared.meta?.opencodeExportManifest === 'string' ? prepared.meta.opencodeExportManifest : null,
        opencodeExportCounts:
          typeof prepared.meta?.opencodeExportCounts === 'object' && prepared.meta.opencodeExportCounts
            ? prepared.meta.opencodeExportCounts
            : null,
        figureWidthPx,
      },
      args.sections,
    ),
    'utf8',
  );

  return { analysisDir, outDir, htmlPath, figuresDir, figures };
}
