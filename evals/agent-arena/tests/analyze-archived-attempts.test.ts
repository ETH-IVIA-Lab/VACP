import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeArenaRun } from '../src/analyze/analyze-run.ts';

async function main() {
  await testArchivedAttemptsDoNotCountAsCurrentRuns();
  console.log('analyze-archived-attempts: ok');
}

async function testArchivedAttemptsDoNotCountAsCurrentRuns() {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'arena-analyze-attempts-'));

  try {
    const runDir = path.join(tmpRoot, 'run');

    const currentJobDir = path.join(
      runDir,
      'runs',
      'experiment=plain-mcp',
      'scenario=scenario-current',
      'modelProvider=openai',
      'modelName=gpt-5.4',
    );

    const archivedJobDir = path.join(currentJobDir, 'attempts', '2026-06-11T17-00-00-000Z__policy_rerun_failed');

    await writeJob(currentJobDir, {
      scenarioID: 'scenario-current',
      ok: true,
      startedAt: '2026-06-11T17:00:00.000Z',
      finishedAt: '2026-06-11T17:00:01.000Z',
    });
    await writeJob(archivedJobDir, {
      scenarioID: 'scenario-archived',
      ok: false,
      startedAt: '2026-06-11T16:59:00.000Z',
      finishedAt: '2026-06-11T16:59:01.000Z',
      errorMessage: 'session.prompt timed out after 1200000ms',
    });

    const analysis = await analyzeArenaRun({ runDir });
    const rows = JSON.parse(await fs.readFile(analysis.runsJsonPath, 'utf8')) as Array<Record<string, unknown>>;

    assert.equal(rows.length, 1);
    assert.equal(rows[0].scenario_id, 'scenario-current');
    assert.equal(rows[0].ok, true);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
}

async function writeJob(
  jobDir: string,
  args: {
    scenarioID: string;
    ok: boolean;
    startedAt: string;
    finishedAt: string;
    errorMessage?: string;
  },
) {
  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(
    path.join(jobDir, 'input.json'),
    JSON.stringify(
      {
        experiment: 'plain-mcp',
        model: {
          providerID: 'openai',
          modelID: 'gpt-5.4',
          pricing: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
        },
        scenario: {
          id: args.scenarioID,
          url: 'http://127.0.0.1:5173/example',
          task: 'Return a JSON answer.',
        },
      },
      null,
      2,
    ) + '\n',
  );
  await fs.writeFile(
    path.join(jobDir, 'run.json'),
    JSON.stringify(
      {
        experiment: 'plain-mcp',
        scenario: { id: args.scenarioID, url: 'http://127.0.0.1:5173/example' },
        ok: args.ok,
        startedAt: args.startedAt,
        finishedAt: args.finishedAt,
        ...(args.errorMessage ? { error: { message: args.errorMessage } } : {}),
      },
      null,
      2,
    ) + '\n',
  );
}

void main();
