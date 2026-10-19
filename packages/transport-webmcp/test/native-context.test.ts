import assert from 'node:assert/strict';
import test from 'node:test';
import type { WebMCP } from 'webmcp-types';
import { createVacpProvider, createVacpRuntime, VacpActionRegistry } from '@ethivia/vacp-runtime';
import { compileVacpWebMcpTools, installVacpWebMcp } from '../src/index';

// Native hosts can omit the context required by webmcp-types declarations.
function executeNative(tool: WebMCP.ModelContextTool, input: Record<string, unknown>) {
  const execute = tool.execute as (input: Record<string, unknown>) => Promise<unknown>;
  return execute(input);
}

test('native callers may omit execution context while runtime disposal remains authoritative', async () => {
  const actions = new VacpActionRegistry();
  actions.register({ name: 'answer', description: 'Return an answer', operation: { kind: 'query' } }, () => 42);
  const provider = createVacpProvider({
    subscribe: () => () => {},
    source: { id: 'vacp-source://native', type: 'test', title: 'Native' },
    actions,
    project: () => ({
      graph: { nodes: [], edges: [], actions: actions.list() },
      state: {},
    }),
  });
  const runtime = createVacpRuntime({ providers: [provider] });
  try {
    const tools = compileVacpWebMcpTools((await runtime.observe()).graph, runtime);
    const compiledAction = tools.find((tool) => tool.name === 'vacp.action.answer');
    assert.ok(compiledAction);
    const result = await executeNative(compiledAction, { narration: 'Answering.' });
    assert.ok(result && typeof result === 'object' && 'result' in result);
    assert.equal(result.result, 42);
    const observe = tools.find((tool) => tool.name === 'vacp.observe');
    assert.ok(observe);
    const observation = await executeNative(observe, {});
    assert.ok(observation && typeof observation === 'object' && 'graph' in observation);
    assert.deepEqual(observation.graph, {
      sources: [{ id: 'vacp-source://native', type: 'test', title: 'Native' }],
      nodes: [],
      edges: [],
    });
    const registered = new Map<string, WebMCP.ModelContextTool>();
    await installVacpWebMcp(runtime, {
      context: {
        async registerTool(tool) {
          registered.set(tool.name, tool);
        },
      },
    });
    const action = registered.get('vacp.action.answer');
    assert.ok(action);
    const installedResult = await executeNative(action, { narration: 'Answering.' });
    assert.ok(installedResult && typeof installedResult === 'object' && 'result' in installedResult);
    assert.equal(installedResult.result, 42);
    runtime.dispose();
    await assert.rejects(executeNative(action, { narration: 'Answering.' }), /abort/i);
  } finally {
    runtime.dispose();
  }
});
