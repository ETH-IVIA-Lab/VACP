import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { computeJobArtifactPaths, computeJobIdentityKey } from '../src/runner/job-state.ts';
import {
  buildResumeOutcomeSelection,
  parseResumeRerunOutcomesCsv,
  type ResumeRerunOutcome,
} from '../src/runner/resume-selective.ts';
import type { ArenaJob } from '../src/types.ts';

async function main() {
  testParseOutcomes();
  await testBuildSelectionByOutcome();
  await testBuildSelectionFailsWhenAnalysisCannotMatchCurrentRun();
  await testBuildSelectionFailsWhenAnalysisIsStale();
  console.log('resume-selective: ok');
}

function testParseOutcomes() {
  assert.equal(parseResumeRerunOutcomesCsv(undefined), null);
  assert.deepEqual(parseResumeRerunOutcomesCsv('protocol_failure, plumbing_failure, protocol_failure'), [
    'protocol_failure',
    'plumbing_failure',
  ]);
  assert.throws(() => parseResumeRerunOutcomesCsv('semantic_failure'), /Unsupported --rerun-outcomes/);
  assert.throws(() => parseResumeRerunOutcomesCsv(' , '), /requires at least one value/);
}

async function testBuildSelectionByOutcome() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'arena-resume-selective-'));
  const runDir = path.join(tmp, 'run-001');
  await fs.mkdir(runDir, { recursive: true });

  const jobs = [
    job({
      experiment: 'baseline',
      scenarioId: 'scenario-1',
      provider: 'openai',
      model: 'gpt-5.2',
    }),
    job({
      experiment: 'with-snapshot',
      scenarioId: 'scenario-2',
      provider: 'openai',
      model: 'gpt-5.2',
    }),
  ];

  await writeRunArtifacts({
    runDir,
    job: jobs[0],
    index: 0,
    sessionID: 'ses_a',
    startedAt: '2026-02-12T00:00:00.000Z',
    finishedAt: '2026-02-12T00:01:00.000Z',
    ok: true,
  });
  await writeRunArtifacts({
    runDir,
    job: jobs[1],
    index: 1,
    sessionID: 'ses_b',
    startedAt: '2026-02-12T00:02:00.000Z',
    finishedAt: '2026-02-12T00:03:00.000Z',
    ok: true,
  });

  const analysisDir = path.join(runDir, 'analysis');
  await writeAnalysis({
    analysisDir,
    runDir,
    runs: [
      analysisRow({
        runDir,
        job: jobs[0],
        sessionID: 'ses_a',
        startedAt: '2026-02-12T00:00:00.000Z',
        finishedAt: '2026-02-12T00:01:00.000Z',
        evalOutcome: 'protocol_failure',
      }),
      analysisRow({
        runDir,
        job: jobs[1],
        sessionID: 'ses_b',
        startedAt: '2026-02-12T00:02:00.000Z',
        finishedAt: '2026-02-12T00:03:00.000Z',
        evalOutcome: 'solved_semantic',
      }),
    ],
  });

  const selection = await buildResumeOutcomeSelection({
    runDir,
    analysisDir,
    jobs,
    selectedOutcomes: ['protocol_failure'],
  });

  assert.equal(selection.completeJobs, 2);
  assert.equal(selection.matchedJobs, 2);
  assert.equal(selection.forcedByJobKey.size, 1);
  const key = computeJobIdentityKey({ job: jobs[0], index: 0 });
  assert.equal(selection.forcedByJobKey.get(key)?.outcome, 'protocol_failure');
}

async function testBuildSelectionFailsWhenAnalysisCannotMatchCurrentRun() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'arena-resume-selective-mismatch-'));
  const runDir = path.join(tmp, 'run-002');
  await fs.mkdir(runDir, { recursive: true });

  const jobs = [
    job({
      experiment: 'baseline',
      scenarioId: 'scenario-1',
      provider: 'openai',
      model: 'gpt-5.2',
    }),
  ];

  await writeRunArtifacts({
    runDir,
    job: jobs[0],
    index: 0,
    sessionID: 'ses_real',
    startedAt: '2026-02-12T01:00:00.000Z',
    finishedAt: '2026-02-12T01:01:00.000Z',
    ok: true,
  });

  const analysisDir = path.join(runDir, 'analysis');
  await writeAnalysis({
    analysisDir,
    runDir,
    runs: [
      analysisRow({
        runDir,
        job: jobs[0],
        sessionID: 'ses_old',
        startedAt: '2026-02-11T01:00:00.000Z',
        finishedAt: '2026-02-11T01:01:00.000Z',
        evalOutcome: 'protocol_failure',
      }),
    ],
  });

  await assert.rejects(
    () =>
      buildResumeOutcomeSelection({
        runDir,
        analysisDir,
        jobs,
        selectedOutcomes: ['protocol_failure'],
      }),
    /Analysis is insufficient for selective resume/,
  );
}

async function testBuildSelectionFailsWhenAnalysisIsStale() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'arena-resume-selective-stale-'));
  const runDir = path.join(tmp, 'run-003');
  await fs.mkdir(runDir, { recursive: true });

  const jobs = [
    job({
      experiment: 'baseline',
      scenarioId: 'scenario-1',
      provider: 'openai',
      model: 'gpt-5.2',
    }),
  ];

  const paths = await writeRunArtifacts({
    runDir,
    job: jobs[0],
    index: 0,
    sessionID: 'ses_a',
    startedAt: '2026-02-12T02:00:00.000Z',
    finishedAt: '2026-02-12T02:01:00.000Z',
    ok: true,
  });

  const analysisDir = path.join(runDir, 'analysis');
  const analysisPaths = await writeAnalysis({
    analysisDir,
    runDir,
    runs: [
      analysisRow({
        runDir,
        job: jobs[0],
        sessionID: 'ses_a',
        startedAt: '2026-02-12T02:00:00.000Z',
        finishedAt: '2026-02-12T02:01:00.000Z',
        evalOutcome: 'plumbing_failure',
      }),
    ],
  });

  const now = new Date();
  const older = new Date(now.getTime() - 5_000);
  await fs.utimes(analysisPaths.runsPath, older, older);
  await fs.utimes(paths.runJsonPath, now, now);

  await assert.rejects(
    () =>
      buildResumeOutcomeSelection({
        runDir,
        analysisDir,
        jobs,
        selectedOutcomes: ['plumbing_failure'],
      }),
    /Analysis appears stale/,
  );
}

function job(args: {
  experiment: string;
  scenarioId: string;
  provider: string;
  model: string;
}): ArenaJob {
  return {
    experiment: args.experiment,
    model: { providerID: args.provider, modelID: args.model },
    scenario: {
      id: args.scenarioId,
      url: `http://example.test/${args.scenarioId}`,
      task: 'task',
      responseFormat: '{answer: string}',
    },
  };
}

async function writeRunArtifacts(args: {
  runDir: string;
  job: ArenaJob;
  index: number;
  sessionID: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
}) {
  const paths = computeJobArtifactPaths({ arenaOutDir: args.runDir, job: args.job, index: args.index });
  await fs.mkdir(paths.jobOutDir, { recursive: true });
  await fs.writeFile(paths.inputJsonPath, JSON.stringify(args.job, null, 2) + '\n', 'utf8');
  const run = {
    experiment: args.job.experiment,
    scenario: { id: args.job.scenario.id, url: args.job.scenario.url },
    sessionID: args.sessionID,
    ok: args.ok,
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
  };
  await fs.writeFile(paths.runJsonPath, JSON.stringify(run, null, 2) + '\n', 'utf8');
  return paths;
}

async function writeAnalysis(args: { analysisDir: string; runDir: string; runs: Array<Record<string, unknown>> }) {
  await fs.mkdir(args.analysisDir, { recursive: true });
  const runId = path.basename(args.runDir);
  const meta = {
    runDir: args.runDir,
    runId,
    generatedAt: new Date().toISOString(),
  };
  const metaPath = path.join(args.analysisDir, 'meta.json');
  const runsPath = path.join(args.analysisDir, 'runs.json');
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  await fs.writeFile(runsPath, JSON.stringify(args.runs, null, 2) + '\n', 'utf8');
  return { metaPath, runsPath };
}

function analysisRow(args: {
  runDir: string;
  job: ArenaJob;
  sessionID: string;
  startedAt: string;
  finishedAt: string;
  evalOutcome: ResumeRerunOutcome | 'solved_semantic';
}) {
  return {
    run_id: path.basename(args.runDir),
    experiment: args.job.experiment,
    scenario_id: args.job.scenario.id,
    model_provider: args.job.model.providerID,
    model_name: args.job.model.modelID,
    session_id: args.sessionID,
    started_at: args.startedAt,
    finished_at: args.finishedAt,
    eval_outcome: args.evalOutcome,
  };
}

void main();
