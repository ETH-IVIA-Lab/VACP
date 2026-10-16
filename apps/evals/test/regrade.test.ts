import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { oracleCondition } from '../src/conditions/reference';
import { mentions } from '../src/core/checks';
import type { GradingRecord } from '../src/core/grade';
import { definePage, defineScenario } from '../src/core/scenario';
import { flowRecordPath, variantPaths, type Flow } from '../src/results/layout';
import { regradeFlow } from '../src/results/regrade';
import type { FlowRecord, ResultRow } from '../src/results/rows';
import { appendJsonl, readJson, readJsonl, writeJson } from '../src/results/store';
import { defineSuite } from '../src/suite';

const scratches: string[] = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'vacp-evals-'));
  scratches.push(dir);
  return dir;
};
after(() => {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
});

const page = definePage({ id: 'page', path: '/', title: 'Page' });
const scenario = (answer: string) =>
  defineScenario({
    id: 'page/decline',
    page,
    tags: ['decline'],
    source: 'synthesized',
    why: 'Fixture.',
    turns: [{ say: 'Filter to Brazil.', expect: [mentions(answer)], oracle: { answer: `I ${answer} do that.` } }],
  });

const failedDecline = { pass: 0, state: null, answer: 0, guard: null };
const flow: Flow = { condition: 'webmcp', model: 'mock' };

/** A suite over a fresh results directory, with the scenario's checks as they read now. */
function suiteIn(results: string) {
  const suite = defineSuite({
    providers: { local: { kind: 'openai-compatible', baseURL: 'http://127.0.0.1:1', apiKey: 'test' } },
    models: { mock: { provider: 'local', id: 'mock' } },
    defaultModel: 'mock',
    conditions: { oracle: oracleCondition() },
    defaultCondition: 'oracle',
    scenarios: [scenario("couldn't")],
  });
  return { ...suite, results };
}

/** A flow with one scored run of `page/decline`, recorded for `prompt`, whose reply the old checks failed. */
function recordedFlow(prompt: string) {
  const results = scratch();
  const paths = variantPaths(results, flow, 'baseline');
  const record: GradingRecord = {
    initial: {},
    turns: [{ reply: 'I couldn’t apply that filter.', state: {}, executions: [], texts: {} }],
  };
  writeJson(paths.grading('page/decline', 0), record);
  writeJson(flowRecordPath(results, flow), { eval: { paths: [], sha: 'stale' } } satisfies Partial<FlowRecord>);
  appendJsonl(paths.results, {
    scenario: 'page/decline',
    rep: 0,
    prompt,
    status: 'ok',
    grade: failedDecline,
    explanation: {},
  } satisfies Partial<ResultRow>);
  return { results, paths };
}

async function regrade(results: string) {
  const lines: string[] = [];
  await regradeFlow(suiteIn(results), flow, (line) => lines.push(line));
  return lines;
}

test('regrading re-scores recorded runs from their stored inputs and re-bases the flow on the current checks', async () => {
  const { results, paths } = recordedFlow('Filter to Brazil.');
  const lines = await regrade(results);
  const [row] = readJsonl<ResultRow>(paths.results);
  assert.deepEqual(row!.grade, { pass: 1, state: null, answer: 1, guard: null });
  assert.match(lines[0]!, /1 of 1 rows changed grade, pass 0% → 100%/);
  assert.notEqual(readJson<FlowRecord>(flowRecordPath(results, flow))!.eval.sha, 'stale');
});

test('a run recorded for an earlier wording of its scenario keeps its grade', async () => {
  const { results, paths } = recordedFlow('Filter the athletes to Brazil.');
  const lines = await regrade(results);
  const [row] = readJsonl<ResultRow>(paths.results);
  assert.deepEqual(row!.grade, failedDecline);
  assert.match(lines[0]!, /1 rows of reworded scenarios kept/);
});
