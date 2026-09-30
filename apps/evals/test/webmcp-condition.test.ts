import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { MockLanguageModelV4 } from 'ai/test';
import { traceRecorder } from '../src/adapters/telemetry';
import { toolAlias, webmcpCondition } from '../src/conditions/webmcp';
import { mentions } from '../src/core/checks';
import { definePage, defineScenario } from '../src/core/scenario';
import { Trace } from '../src/core/trace';
import { ToolError, type AgentPage, type PageTool, type ResolvedModel, type TelemetryFor } from '../src/ports';

const usage = (input: number, cached: number) => ({
  inputTokens: { total: input, noCache: input - cached, cacheRead: cached, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
});

function model(steps: NonNullable<ConstructorParameters<typeof MockLanguageModelV4>[0]>['doGenerate']): ResolvedModel {
  return {
    key: 'mock',
    id: 'mock-model',
    provider: { key: 'local', kind: 'openai-compatible', baseURL: 'http://127.0.0.1', apiKey: 'test' },
    language: new MockLanguageModelV4({ doGenerate: steps }),
  };
}

const catalog: PageTool[] = [
  { name: 'vacp.state', description: 'Read state', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'vacp.action.cohort.set_sex',
    description: 'Set sex',
    inputSchema: { type: 'object', properties: { sex: { type: 'string' } } },
  },
];

/** The WebMCP half of a page. The condition reaches the page through its catalog and nothing else. */
function page(calls: Array<[string, unknown]>, failing = new Set<string>()): AgentPage {
  const unused = () => {
    throw new Error('The webmcp condition reaches the page through WebMCP only');
  };
  return {
    tools: async () => catalog,
    callTool: async (name, input) => {
      calls.push([name, input]);
      if (failing.has(name)) throw new ToolError('UnknownError: Tool was executed but the invocation failed');
      return JSON.stringify({ ok: true });
    },
    get bridge(): never {
      return unused();
    },
    act: unused,
  };
}

const scenario = defineScenario({
  id: 'fixture/one',
  page: definePage({ id: 'fixture', path: '/', title: 'Fixture' }),
  tags: ['filter'],
  source: 'synthesized',
  why: 'Fixture.',
  turns: [{ say: 'Show female athletes.', expect: [mentions('female')], oracle: { answer: 'Female athletes.' } }],
});

/** The run's telemetry without a tracer: AI SDK lifecycle events fill `trace` and nothing else. */
const recordTo =
  (trace: Trace): TelemetryFor =>
  (options) => ({ integrations: [traceRecorder(trace, options)] });

async function converse(steps: Parameters<typeof model>[0], pageFor: AgentPage, maxSteps = 8) {
  const condition = webmcpCondition();
  assert.equal(condition.kind, 'agent');
  if (condition.kind !== 'agent') throw new Error('unreachable');
  const session = await condition.start({
    model: model(steps),
    signal: new AbortController().signal,
    workspace: tmpdir(),
  });
  const trace = new Trace();
  const conversation = await session.conversation({
    page: pageFor,
    scenario,
    trace,
    signal: new AbortController().signal,
    maxSteps,
    telemetry: recordTo(trace),
  });
  trace.beginTurn(scenario.turns[0]!.say);
  return { trace, reply: await conversation.say(scenario.turns[0]!.say) };
}

test('the agent calls registered WebMCP names through provider-safe aliases and reports each step in order', async () => {
  const calls: Array<[string, unknown]> = [];
  const alias = toolAlias('vacp.action.cohort.set_sex');
  const { trace, reply } = await converse(
    [
      {
        content: [
          { type: 'text', text: 'Filtering to female athletes.' },
          { type: 'tool-call', toolCallId: 'call-1', toolName: alias, input: JSON.stringify({ sex: 'female' }) },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: usage(1000, 0),
        response: { modelId: 'mock-model' },
        warnings: [],
      },
      {
        content: [{ type: 'text', text: 'The view shows female athletes.' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: usage(1200, 1000),
        response: { modelId: 'mock-model' },
        warnings: [],
      },
    ],
    page(calls),
  );
  assert.deepEqual(reply, { text: 'The view shows female athletes.', stop: 'done' });
  assert.deepEqual(calls, [['vacp.action.cohort.set_sex', { sex: 'female' }]]);
  assert.deepEqual(
    trace.turns.map((turn) => `${turn.role}${turn.name ? `:${turn.name}` : ''}`),
    [
      'user',
      'assistant',
      'tool_call:vacp.action.cohort.set_sex',
      'tool_result:vacp.action.cohort.set_sex',
      'assistant',
    ],
  );
  assert.deepEqual(trace.usage(), { input: 1200, output: 40, cache_read: 1000, cache_write: 0 });
  assert.equal(trace.catalogs.length, 1, 'an unchanged catalog keeps one fingerprint');
});

test('a browser-side tool failure reaches the model as the browser reports it and counts as a tool error', async () => {
  const { trace } = await converse(
    [
      {
        content: [
          { type: 'tool-call', toolCallId: 'call-1', toolName: toolAlias('vacp.action.cohort.set_sex'), input: '{}' },
        ],
        finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        usage: usage(100, 0),
        response: { modelId: 'mock-model' },
        warnings: [],
      },
      {
        content: [{ type: 'text', text: 'I could not change it.' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: usage(100, 0),
        response: { modelId: 'mock-model' },
        warnings: [],
      },
    ],
    page([], new Set(['vacp.action.cohort.set_sex'])),
  );
  const result = trace.turns.find((turn) => turn.role === 'tool_result');
  assert.match(result!.content, /UnknownError: Tool was executed but the invocation failed/);
  assert.equal(trace.tools[0]!.ok, false);
});

test('a run still calling tools when its step budget ends stops as max-steps', async () => {
  const step = {
    content: [{ type: 'tool-call' as const, toolCallId: 'call', toolName: toolAlias('vacp.state'), input: '{}' }],
    finishReason: { unified: 'tool-calls' as const, raw: 'tool_calls' },
    usage: usage(10, 0),
    response: { modelId: 'mock-model' },
    warnings: [],
  };
  const { reply, trace } = await converse([step, step], page([]), 2);
  assert.equal(reply.stop, 'max-steps');
  assert.equal(trace.tools[0]!.read, true, 'a state read counts toward read size');
});

test('aliases keep long tool names within 64 characters and distinct', () => {
  const long = `vacp.action.source_9919ffff291d4e9f.vgplot.${'set_interval_1d_'.repeat(4)}a`;
  const other = `${long.slice(0, -1)}b`;
  assert.ok(toolAlias(long).length <= 64);
  assert.notEqual(toolAlias(long), toolAlias(other));
  assert.equal(toolAlias('vacp.state'), 'vacp_state');
});
