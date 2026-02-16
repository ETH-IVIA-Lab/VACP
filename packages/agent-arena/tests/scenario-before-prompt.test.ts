import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runScenario } from '../src/runner/scenario.ts';
import type { ArenaConfig, ArenaJob } from '../src/types.ts';

async function main() {
  await testBeforePromptRunsBeforePromptAsync();
  await testPromptWaitsForSessionIdleWhenStatusIsBusyFirst();
  await testBeforePromptTimeoutFailsWithoutPrompt();
  console.log('scenario-before-prompt: ok');
}

async function testBeforePromptRunsBeforePromptAsync() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'arena-before-prompt-'));
  const outDir = path.join(tmp, 'run-1');
  await fs.mkdir(outDir, { recursive: true });

  let setupCalled = false;
  let promptCalled = false;
  const client = mockClient({
    onPromptAsync() {
      assert.equal(setupCalled, true);
      promptCalled = true;
    },
  });

  const job = baseJob();
  const config: ArenaConfig = {
    runs: [],
    timeouts: { setupMs: 1000, promptMs: 1000 },
    promptTemplate: () => 'test prompt',
    onBeforePrompt: async (ctx) => {
      assert.equal(ctx.opencode.sessionID, 'session-1');
      setupCalled = true;
    },
  };

  const res = await runScenario({
    config,
    job,
    client: client as any,
    directory: process.cwd(),
    tools: undefined,
    outDir,
    projectID: 'project-1',
    workerID: 2,
    mcpServerAliases: { arena_vacp: 'arena_vacp__lane3' },
  });

  assert.equal(res.ok, true);
  assert.equal(promptCalled, true);
  assert.equal(res.setup?.ok, true);
  assert.equal(res.setup?.hook, 'config');

  const input = JSON.parse(await fs.readFile(path.join(outDir, 'input.json'), 'utf8')) as any;
  assert.equal(input.setup?.timeoutMs, 1000);
  assert.equal(input.setup?.hook, 'config');
  assert.equal(input.setup?.result?.ok, true);
}

async function testBeforePromptTimeoutFailsWithoutPrompt() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'arena-before-prompt-timeout-'));
  const outDir = path.join(tmp, 'run-2');
  await fs.mkdir(outDir, { recursive: true });

  let promptCalled = false;
  const client = mockClient({
    onPromptAsync() {
      promptCalled = true;
    },
  });

  const job = baseJob();
  const config: ArenaConfig = {
    runs: [],
    timeouts: { setupMs: 25, promptMs: 1000 },
    promptTemplate: () => 'test prompt',
    onBeforePrompt: async () => {
      await sleep(100);
    },
  };

  const res = await runScenario({
    config,
    job,
    client: client as any,
    directory: process.cwd(),
    tools: undefined,
    outDir,
  });

  assert.equal(res.ok, false);
  assert.equal(promptCalled, false);
  assert.equal(res.setup?.ok, false);
  assert.match(String(res.error?.message ?? ''), /onBeforePrompt timed out/i);
}

async function testPromptWaitsForSessionIdleWhenStatusIsBusyFirst() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'arena-before-prompt-busy-first-'));
  const outDir = path.join(tmp, 'run-3');
  await fs.mkdir(outDir, { recursive: true });

  let statusCalls = 0;
  const client = mockClient({
    status() {
      statusCalls += 1;
      if (statusCalls === 1) {
        return { 'session-1': { type: 'retry', next: Date.now() + 10 } };
      }
      return { 'session-1': { type: 'idle' } };
    },
  });

  const job = baseJob();
  const config: ArenaConfig = {
    runs: [],
    timeouts: { setupMs: 1000, promptMs: 4000 },
    promptTemplate: () => 'test prompt',
  };

  const res = await runScenario({
    config,
    job,
    client: client as any,
    directory: process.cwd(),
    tools: undefined,
    outDir,
  });

  assert.equal(res.ok, true);
  assert.ok(statusCalls >= 2);
}

function baseJob(): ArenaJob {
  return {
    experiment: 'baseline',
    model: { providerID: 'openai', modelID: 'gpt-5.2' },
    scenario: {
      id: 'scenario-1',
      url: 'http://127.0.0.1:5173/vega-lite/',
      task: 'sample task',
      responseFormat: '{answer: string}',
    },
  };
}

function mockClient(args?: { onPromptAsync?: () => void; status?: () => Record<string, unknown> }) {
  return {
    session: {
      async create() {
        return { data: { id: 'session-1' } };
      },
      async update() {
        return { data: {} };
      },
      async promptAsync() {
        args?.onPromptAsync?.();
        return { data: {} };
      },
      async status() {
        return { data: args?.status ? args.status() : { 'session-1': { type: 'idle' } } };
      },
      async summarize() {
        return { data: {} };
      },
      async abort() {
        return { data: {} };
      },
    },
  };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

void main();
