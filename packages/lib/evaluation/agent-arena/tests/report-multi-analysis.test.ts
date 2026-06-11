import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { exportArenaDatasets } from '../src/report/export-datasets.js';
import { generateArenaReportSuite } from '../src/report/generate-report-suite.js';
import { normalizeAnalysisDirs } from '../src/report/load-analysis.js';
import { prepareArenaAnalysis } from '../src/report/prepare.js';

async function main() {
  await testMergedAnalysisPreservesRunIdentity();
  testBlankAnalysisDirsAreRejected();
  console.log('report-multi-analysis: ok');
}

async function testMergedAnalysisPreservesRunIdentity() {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'arena-report-multi-analysis-'));
  try {
    const analysisA = await writeAnalysis({
      root: tmpRoot,
      runId: 'run-a',
      solvedSemantic: true,
      costUsd: 0.25,
      tool: 'agent-browser',
    });
    const analysisB = await writeAnalysis({
      root: tmpRoot,
      runId: 'run-b',
      solvedSemantic: true,
      solvedStrict: false,
      costUsd: 0.5,
      tool: 'vacp_execute',
      modelProvider: 'openai',
      modelName: 'gpt-5.4',
    });

    const prepared = await prepareArenaAnalysis({ analysisDir: [analysisA, analysisB] });

    assert.equal(prepared.runs.length, 2);
    assert.deepEqual(prepared.runs.map((run) => run.runId).sort(), ['run-a', 'run-b']);
    assert.equal(prepared.analysisSources.length, 2);
    assert.equal(prepared.summaries.find((row) => row.experiment === 'baseline')?.n, 2);

    const datasetsDir = path.join(tmpRoot, 'datasets');
    await exportArenaDatasets({ analysisDir: [analysisA, analysisB], outDir: datasetsDir, charts: [] });
    const normalizedRuns = JSON.parse(
      await fs.readFile(path.join(datasetsDir, 'runs_normalized.json'), 'utf8'),
    ) as Array<Record<string, unknown>>;
    assert.deepEqual(normalizedRuns.map((run) => run.run_id).sort(), ['run-a', 'run-b']);
    const datasetsMeta = JSON.parse(await fs.readFile(path.join(datasetsDir, 'meta.json'), 'utf8')) as {
      analysis_sources: unknown[];
    };
    assert.equal(datasetsMeta.analysis_sources.length, 2);

    const reportDir = path.join(tmpRoot, 'report');
    const report = await generateArenaReportSuite({
      analysisDir: [analysisA, analysisB],
      outDir: reportDir,
      charts: [],
    });
    const indexHtml = await fs.readFile(report.indexHtmlPath, 'utf8');
    const indexText = documentText(indexHtml);
    assert.match(indexText, /Sources: 2 analyses/);
    assert.match(indexText, /run-a, run-b/);

    assert.ok(report.allHtmlPath);
    const allHtml = await fs.readFile(report.allHtmlPath, 'utf8');
    const allDocument = new JSDOM(allHtml).window.document;
    const runDetail = allDocument.querySelector('#section-run-detail');
    assert.ok(runDetail);
    assert.deepEqual(
      Array.from(runDetail.querySelectorAll('h3')).map((heading) => cleanText(heading.textContent)),
      ['Run x Experiment Matrix', 'Task Run Strip', 'Final Run Ledger'],
    );
    assert.equal(runDetail.querySelectorAll('article').length, 2);

    const runDetailText = cleanText(runDetail.textContent);
    assert.match(runDetailText, /run-a/);
    assert.match(runDetailText, /run-b/);
    assert.match(runDetailText, /google\/gemini-3\.1-pro-preview/);
    assert.match(runDetailText, /openai\/gpt-5\.4/);
    assert.match(runDetailText, /Strict/);
    assert.match(runDetailText, /Semantic/);
    assert.match(runDetailText, /\$0\.25/);
    assert.match(runDetailText, /\$0\.50/);
    assert.equal(runDetailText.includes(tmpRoot), false);
    const pillTitles = Array.from(runDetail.querySelectorAll('span[title*="Model:"]')).map((span) =>
      span.getAttribute('title'),
    );
    assert.equal(
      pillTitles.some((title) => title?.includes('Model: google/gemini-3.1-pro-preview')),
      true,
    );
    assert.equal(
      pillTitles.some((title) => title?.includes('Model: openai/gpt-5.4')),
      true,
    );
    const semanticOnlyTitle = pillTitles.find((title) => title?.includes('Run: run-b'));
    assert.match(semanticOnlyTitle ?? '', /Outcome: Semantic/);

    const googleReport = report.modelReports.find((modelReport) => modelReport.modelProvider === 'google');
    assert.ok(googleReport);
    const googleHtml = await fs.readFile(googleReport.htmlPath, 'utf8');
    const googleRunDetail = new JSDOM(googleHtml).window.document.querySelector('#section-run-detail');
    assert.ok(googleRunDetail);
    assert.equal(googleRunDetail.querySelectorAll('article').length, 1);
    assert.match(cleanText(googleRunDetail.textContent), /run-a/);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

function testBlankAnalysisDirsAreRejected() {
  assert.throws(() => normalizeAnalysisDirs(['', '   ']), /Expected at least one analysis directory/);
}

async function writeAnalysis(args: {
  root: string;
  runId: string;
  solvedSemantic: boolean;
  solvedStrict?: boolean;
  costUsd: number;
  tool: string;
  modelProvider?: string;
  modelName?: string;
}) {
  const analysisDir = path.join(args.root, args.runId, 'analysis');
  await fs.mkdir(analysisDir, { recursive: true });
  await fs.writeFile(
    path.join(analysisDir, 'meta.json'),
    JSON.stringify(
      {
        runId: args.runId,
        runDir: path.join(args.root, args.runId),
        generatedAt: `2026-06-11T09:${args.runId === 'run-a' ? '00' : '01'}:00.000Z`,
      },
      null,
      2,
    ) + '\n',
  );
  await fs.writeFile(
    path.join(analysisDir, 'runs.json'),
    JSON.stringify(
      [
        {
          run_id: args.runId,
          experiment: 'baseline',
          scenario_id: 'uc1-locate',
          model_provider: args.modelProvider ?? 'google',
          model_name: args.modelName ?? 'gemini-3.1-pro-preview',
          ok: true,
          plumbing_ok: true,
          answer_parse_status: 'ok',
          solved_strict: args.solvedStrict ?? args.solvedSemantic,
          solved_semantic: args.solvedSemantic,
          cost_usd: args.costUsd,
          tokens_input: 100,
          tokens_output: 20,
          tokens_reasoning: 5,
          tokens_cache_read: 0,
          tokens_cache_write: 0,
          tool_calls: 1,
          tool_errors: 0,
        },
      ],
      null,
      2,
    ) + '\n',
  );
  await fs.writeFile(
    path.join(analysisDir, 'tool_calls.json'),
    JSON.stringify(
      [
        {
          run_id: args.runId,
          experiment: 'baseline',
          scenario_id: 'uc1-locate',
          model_provider: args.modelProvider ?? 'google',
          model_name: args.modelName ?? 'gemini-3.1-pro-preview',
          session_id: `session-${args.runId}`,
          tool: args.tool,
          status: 'completed',
          duration_ms: 100,
        },
      ],
      null,
      2,
    ) + '\n',
  );
  return analysisDir;
}

function documentText(html: string) {
  return cleanText(new JSDOM(html).window.document.body.textContent);
}

function cleanText(text: string | null) {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

void main();
