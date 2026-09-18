import assert from 'node:assert/strict';
import type { ArenaJob } from '../src/types.ts';
import { createLaneRuntimeJob, rewritePromptForLane } from '../src/runner/mcp-lane.ts';

function main() {
  const base: ArenaJob = {
    experiment: 'pure-vacp',
    model: { providerID: 'openai', modelID: 'gpt-5.2' },
    scenario: {
      id: 'vl-global-development-t1-lifeexp-max-2000',
      url: 'http://127.0.0.1:5173/vega-lite/?expose-bridge=1#global-development',
      task: 'Which country had the highest life expectancy in 2000?',
      responseFormat: '{country: string}',
    },
    toolPolicy: {
      mode: 'allow',
      ids: ['functions.read', 'functions.arena_vacp_vacp_open_url', 'arena_vacp_vacp_state', 'arena_vacp_*'],
    },
    mcp: {
      servers: {
        arena_vacp: { type: 'local', command: ['vacp'] },
        arena_vacp_toolkit: { type: 'local', command: ['vacp', '--enable-browser-tools'] },
      },
      allow: ['arena_vacp', 'arena_vacp_toolkit_*', 'other_*'],
    },
  };

  const runtime = createLaneRuntimeJob({ job: base, workerID: 1 });
  assert.deepEqual(runtime.serverAliases, {
    arena_vacp: 'arena_vacp__lane2',
    arena_vacp_toolkit: 'arena_vacp_toolkit__lane2',
  });

  assert.deepEqual(Object.keys(runtime.job.mcp?.servers ?? {}).sort(), [
    'arena_vacp__lane2',
    'arena_vacp_toolkit__lane2',
  ]);
  assert.deepEqual(runtime.job.mcp?.allow, ['arena_vacp__lane2', 'arena_vacp_toolkit__lane2_*', 'other_*']);
  assert.deepEqual(runtime.job.toolPolicy.ids, [
    'functions.read',
    'functions.arena_vacp__lane2_vacp_open_url',
    'arena_vacp__lane2_vacp_state',
    'arena_vacp__lane2_*',
  ]);

  const rewrittenPrompt = rewritePromptForLane(
    [
      'Start with arena_vacp_vacp_open_url.',
      'Then use arena_vacp_vacp_state.',
      'Wildcard: arena_vacp_*.',
      'Toolkit: arena_vacp_toolkit_browser_screenshot.',
    ].join(' '),
    runtime.serverAliases,
  );

  assert.ok(rewrittenPrompt.includes('arena_vacp__lane2_vacp_open_url'));
  assert.ok(rewrittenPrompt.includes('arena_vacp__lane2_vacp_state'));
  assert.ok(rewrittenPrompt.includes('arena_vacp__lane2_*'));
  assert.ok(rewrittenPrompt.includes('arena_vacp_toolkit__lane2_browser_screenshot'));

  const noMcp: ArenaJob = {
    ...base,
    mcp: undefined,
    toolPolicy: { mode: 'allow', ids: ['functions.read'] },
  };

  const noMcpRuntime = createLaneRuntimeJob({ job: noMcp, workerID: 3 });
  assert.deepEqual(noMcpRuntime.serverAliases, {});
  assert.deepEqual(noMcpRuntime.job, noMcp);

  console.log('mcp-lane-runtime: ok');
}

main();
