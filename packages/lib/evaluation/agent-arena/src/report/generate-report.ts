import fs from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { buildDefaultFigures, DEFAULT_THEME, type ArenaAnyChart, type ArenaReportTheme } from './charts.js';
import { prepareArenaAnalysis } from './prepare.js';
import { renderArenaReportHtml, type ArenaReportSection } from './render-html.js';

export type GenerateArenaReportArgs = {
  analysisDir: string;
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
  const analysisDir = path.resolve(args.analysisDir);
  const outDir = path.resolve(args.outDir ?? path.join(analysisDir, 'report'));

  const prepared = await prepareArenaAnalysis({ analysisDir, ...(args.filter ? { filter: args.filter } : {}) });
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
    const rows = Array.isArray((f as any).data) ? ((f as any).data as unknown[]) : [];
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
        modelLabel: args.modelLabel ?? null,
        indexHref: args.indexHref ?? null,
        taskIndex: prepared.taskIndex,
        experiments: prepared.experimentDomain,
        taskSummaries: prepared.taskSummaries,
        scenarioDefsPath: prepared.scenarioDefsPath,
        opencodeEvidenceDir:
          typeof prepared.meta?.opencodeEvidenceDir === 'string' ? prepared.meta.opencodeEvidenceDir : null,
        opencodeEvidenceManifest:
          typeof prepared.meta?.opencodeEvidenceManifest === 'string' ? prepared.meta.opencodeEvidenceManifest : null,
        opencodeEvidenceSourceStorageDir:
          typeof prepared.meta?.opencodeEvidenceSourceStorageDir === 'string'
            ? prepared.meta.opencodeEvidenceSourceStorageDir
            : typeof prepared.meta?.opencodeStorageDir === 'string'
              ? prepared.meta.opencodeStorageDir
              : null,
        opencodeEvidenceComplete:
          typeof prepared.meta?.opencodeEvidenceComplete === 'boolean' ? prepared.meta.opencodeEvidenceComplete : null,
        opencodeEvidenceGeneratedAt:
          typeof prepared.meta?.opencodeEvidenceGeneratedAt === 'string'
            ? prepared.meta.opencodeEvidenceGeneratedAt
            : null,
        figureWidthPx,
      },
      args.sections,
    ),
    'utf8',
  );

  return { analysisDir, outDir, htmlPath, figuresDir, figures };
}
