import assert from 'node:assert/strict';
import test from 'node:test';
import { VACP_SCHEMA_VERSION } from '@vacp/protocol';
import { createVacpProvider, createVacpRuntime, VacpActionRegistry } from '@vacp/runtime';
import { compileVacpWebMcpTools, installVacpWebMcp } from '../src/index.ts';

// JavaScript hosts can omit context even when third-party TypeScript declarations require it.
test('native callers may omit execution context while runtime disposal remains authoritative', async () => {
  const actions = new VacpActionRegistry();
  actions.register({ name: 'answer', description: 'Return an answer', operation: { kind: 'query' } }, () => 42);
  const provider = createVacpProvider({
    source: { id: 'vacp-source://native', type: 'test', title: 'Native' },
    actions,
    project: () => ({ graph: { version: VACP_SCHEMA_VERSION, nodes: [], edges: [] }, state: {} }),
  });
  const runtime = createVacpRuntime({ providers: [provider] });
  try {
    const tools = compileVacpWebMcpTools((await runtime.observe()).graph, runtime);
    assert.equal((await tools.find((tool) => tool.name === 'vacp.action.answer').execute({})).result, 42);
    assert.equal((await tools.find((tool) => tool.name === 'vacp.observe').execute({})).graph.sources.length, 1);
    const registered = new Map();
    await installVacpWebMcp(runtime, {
      context: {
        async registerTool(tool) {
          registered.set(tool.name, tool);
        },
      },
    });
    const action = registered.get('vacp.action.answer');
    assert.equal((await action.execute({})).result, 42);
    runtime.dispose();
    await assert.rejects(action.execute({}), /abort/i);
  } finally {
    runtime.dispose();
  }
});
