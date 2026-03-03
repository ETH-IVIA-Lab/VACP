import fs from 'node:fs/promises';
import path from 'node:path';
import { base64UrlEncode, sanitizeSegment } from '../paths.js';
import { generateArenaReport, type GenerateArenaReportArgs } from './generate-report.js';
import { renderArenaReportIndexHtml, type ArenaReportIndexModelRow } from './render-index.js';
import { prepareArenaAnalysis } from './prepare.js';
import type { NormalizedRun } from './stats.js';
import { isGradeable, isParseOk } from '../eval/outcome.js';

export type GenerateArenaReportSuiteArgs = Omit<
  GenerateArenaReportArgs,
  'outDir' | 'filter' | 'modelLabel' | 'indexHref'
> & {
  outDir?: string;
  includeAllReport?: boolean;
};

export type GenerateArenaReportSuiteResult = {
  analysisDir: string;
  outDir: string;
  indexHtmlPath: string;
  allHtmlPath: string | null;
  modelReports: Array<{
    modelProvider: string;
    modelName: string;
    modelLabel: string;
    slug: string;
    outDir: string;
    htmlPath: string;
  }>;
};

export async function generateArenaReportSuite(
  args: GenerateArenaReportSuiteArgs,
): Promise<GenerateArenaReportSuiteResult> {
  const analysisDir = path.resolve(args.analysisDir);
  const outDir = path.resolve(args.outDir ?? path.join(analysisDir, 'report'));

  const prepared = await prepareArenaAnalysis({ analysisDir });
  const runs = prepared.runs;

  const runId = typeof prepared.meta?.runId === 'string' ? prepared.meta.runId : null;
  const generatedAt = typeof prepared.meta?.generatedAt === 'string' ? prepared.meta.generatedAt : null;
  const scenarioDefsPath = prepared.scenarioDefsPath;

  const includeAllReport = args.includeAllReport !== false;

  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  const modelKeys = collectModelKeys(runs);
  const modelReports: GenerateArenaReportSuiteResult['modelReports'] = [];

  for (const key of modelKeys) {
    const slug = modelSlug(key.modelProvider, key.modelName);
    const modelOutDir = path.join(outDir, 'models', slug);
    const modelLabel = formatModelLabel(key.modelProvider, key.modelName);

    const res = await generateArenaReport({
      ...args,
      analysisDir,
      outDir: modelOutDir,
      filter: { modelProvider: key.modelProvider, modelName: key.modelName },
      modelLabel,
      indexHref: '../../index.html',
    });

    modelReports.push({
      modelProvider: key.modelProvider,
      modelName: key.modelName,
      modelLabel,
      slug,
      outDir: modelOutDir,
      htmlPath: res.htmlPath,
    });
  }

  let allHtmlPath: string | null = null;
  if (includeAllReport) {
    const allOutDir = path.join(outDir, 'all');
    const res = await generateArenaReport({
      ...args,
      analysisDir,
      outDir: allOutDir,
      indexHref: '../index.html',
    });
    allHtmlPath = res.htmlPath;
  }

  const indexHtmlPath = path.join(outDir, 'index.html');
  const modelRows = buildIndexModelRows(runs, modelReports);
  await fs.writeFile(
    indexHtmlPath,
    renderArenaReportIndexHtml({
      analysisDir,
      runId,
      generatedAt,
      scenarioDefsPath,
      models: modelRows,
      allHref: includeAllReport ? 'all/index.html' : null,
    }),
    'utf8',
  );

  return { analysisDir, outDir, indexHtmlPath, allHtmlPath, modelReports };
}

function collectModelKeys(runs: NormalizedRun[]) {
  const seen = new Map<string, { modelProvider: string; modelName: string }>();
  for (const r of runs) {
    const provider = r.modelProvider || 'unknown';
    const name = r.modelName || 'unknown';
    const key = `${provider}__${name}`;
    if (!seen.has(key)) seen.set(key, { modelProvider: provider, modelName: name });
  }
  return Array.from(seen.values()).sort((a, b) =>
    formatModelLabel(a.modelProvider, a.modelName).localeCompare(formatModelLabel(b.modelProvider, b.modelName)),
  );
}

function formatModelLabel(modelProvider: string, modelName: string) {
  const provider = modelProvider || 'unknown';
  const name = modelName || 'unknown';
  return `${provider}/${name}`;
}

function modelSlug(modelProvider: string, modelName: string) {
  // NOTE: `npx serve` treats directory names with dots oddly (shows directory listing
  // instead of serving `index.html`). Replace dots to keep report URLs browseable.
  const provider = (sanitizeSegment(modelProvider || 'unknown') || 'unknown').replace(/\./g, '-');
  const nameRaw = (sanitizeSegment(modelName || 'unknown') || 'unknown').replace(/\./g, '-');
  const name = nameRaw.slice(0, 60) || 'unknown';
  const hash = base64UrlEncode(`${modelProvider}/${modelName}`).slice(0, 8);
  return `${provider}__${name}__${hash}`;
}

function buildIndexModelRows(
  runs: NormalizedRun[],
  reports: GenerateArenaReportSuiteResult['modelReports'],
): ArenaReportIndexModelRow[] {
  const reportByKey = new Map<string, (typeof reports)[number]>();
  for (const r of reports) reportByKey.set(`${r.modelProvider}__${r.modelName}`, r);

  const byModel = new Map<string, typeof runs>();
  for (const r of runs) {
    const key = `${r.modelProvider}__${r.modelName}`;
    const list = byModel.get(key);
    if (list) list.push(r);
    else byModel.set(key, [r]);
  }

  const rows: ArenaReportIndexModelRow[] = [];
  for (const [key, modelRuns] of byModel) {
    const report = reportByKey.get(key);
    if (!report) continue;

    const experiments = new Set<string>();
    for (const r of modelRuns) if (r.experiment) experiments.add(r.experiment);

    rows.push({
      modelLabel: report.modelLabel,
      modelProvider: report.modelProvider,
      modelName: report.modelName,
      runs: modelRuns.length,
      experiments: experiments.size,
      okRate: modelRuns.length ? modelRuns.filter((r) => r.ok).length / modelRuns.length : 0,
      plumbingOkRate: fractionOrNull(modelRuns.map((r) => r.plumbingOk)),
      protocolOkRate: fractionOrNull(modelRuns.map((r) => isParseOk(r.answerParseStatus))),
      gradeableRate: fractionOrNull(
        modelRuns.map((r) =>
          isGradeable({
            plumbingOk: r.plumbingOk,
            parseStatus: r.answerParseStatus,
            solvedStrict: r.solvedStrict,
            solvedSemantic: r.solvedSemantic,
          }),
        ),
      ),
      solvedSemanticRate: fractionOrNull(modelRuns.map((r) => r.solvedSemantic)),
      durationMedianS: median(modelRuns.flatMap((r) => (typeof r.durationS === 'number' ? [r.durationS] : []))),
      costTotalUsd: sum(modelRuns.flatMap((r) => (typeof r.costUsd === 'number' ? [r.costUsd] : []))),
      costMedianUsd: median(modelRuns.flatMap((r) => (typeof r.costUsd === 'number' ? [r.costUsd] : []))),
      tokensMedianNoCache: median(
        modelRuns.flatMap((r) => (typeof r.tokensTotalNoCache === 'number' ? [r.tokensTotalNoCache] : [])),
      ),
      tokensMedianWithCacheRead: median(
        modelRuns.flatMap((r) => (typeof r.tokensTotalWithCacheRead === 'number' ? [r.tokensTotalWithCacheRead] : [])),
      ),
      tokensMedianWithCacheAll: median(
        modelRuns.flatMap((r) => (typeof r.tokensTotalWithCacheAll === 'number' ? [r.tokensTotalWithCacheAll] : [])),
      ),
      href: `models/${report.slug}/index.html`,
    });
  }

  rows.sort((a, b) => a.modelLabel.localeCompare(b.modelLabel));
  return rows;
}

function fractionOrNull(values: Array<boolean | null>) {
  const usable = values.filter((v): v is boolean => typeof v === 'boolean');
  if (!usable.length) return null;
  return usable.filter(Boolean).length / usable.length;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function sum(values: number[]) {
  if (!values.length) return null;
  return values.reduce((acc, value) => acc + value, 0);
}
