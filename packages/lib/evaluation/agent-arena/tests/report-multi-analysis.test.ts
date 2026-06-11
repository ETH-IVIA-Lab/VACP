import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
      solvedSemantic: false,
      costUsd: 0.5,
      tool: 'vacp_execute',
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
    assert.equal(indexHtml.includes('Sources: 2 analyses'), true);
    assert.equal(indexHtml.includes('run-a, run-b'), true);
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
  costUsd: number;
  tool: string;
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
          model_provider: 'google',
          model_name: 'gemini-3.1-pro-preview',
          ok: true,
          plumbing_ok: true,
          answer_parse_status: 'ok',
          solved_strict: args.solvedSemantic,
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
          model_provider: 'google',
          model_name: 'gemini-3.1-pro-preview',
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

void main();
