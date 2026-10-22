import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  vacpAgentToolGuidance,
  vacpAgentTools,
  VACP_NARRATION_MAX_LENGTH,
  type VacpProvider,
} from '@ethivia/vacp-protocol';
import { createVacpRuntime } from '@ethivia/vacp-runtime';
import { createVacpTransport, type VacpTransport } from '@ethivia/vacp-bridge';
import { asSchema, simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

import {
  createVacpAgentTools,
  createVacpChatRuntime,
  createVacpToolLoopAgent,
  defaultVacpAgentInstructions,
} from '../src/index';

const context = { toolCallId: 'call', messages: [], context: undefined };

const silentTransport: VacpTransport = {
  vacp_observe: async () => ({}),
  vacp_capabilities: async () => ({}),
  vacp_state: async () => ({}),
  vacp_execute: async (input) => ({ callId: input.call_id ?? 'call', ok: true }),
  vacp_progress: async () => ({ ok: true }),
};

test('the agent tools carry the names, descriptions, and input fields every transport offers', async () => {
  const tools = createVacpAgentTools(silentTransport);
  assert.deepEqual(Object.keys(tools).sort(), Object.keys(vacpAgentTools).sort());
  for (const [name, contract] of Object.entries(vacpAgentTools)) {
    const tool = tools[name as keyof typeof tools];
    assert.equal(tool.description, contract.description);
    const schema = (await asSchema<unknown>(tool.inputSchema).jsonSchema) as {
      properties?: Record<string, unknown>;
    };
    assert.deepEqual(Object.keys(schema.properties ?? {}).sort(), [...contract.input].sort());
  }
});

test('sentences are checked by the narration parser and published with its bound', async () => {
  const tools = createVacpAgentTools(silentTransport);
  for (const [tool, field] of [
    [tools.vacp_execute, 'narration'],
    [tools.vacp_progress, 'message'],
  ] as const) {
    const schema = asSchema<unknown>(tool.inputSchema);
    const json = (await schema.jsonSchema) as {
      properties: Record<string, { minLength?: number; maxLength?: number }>;
    };
    assert.equal(json.properties[field]!.minLength, 1);
    assert.equal(json.properties[field]!.maxLength, VACP_NARRATION_MAX_LENGTH);
    const input = (sentence: string) => ({ name: 'set', message: sentence, narration: sentence });
    const accepts = async (sentence: string) => (await schema.validate!(input(sentence))).success;
    assert.equal(await accepts('😀'.repeat(280)), true, 'code points, not UTF-16 units, are counted');
    assert.equal(await accepts('😀'.repeat(281)), false);
    assert.equal(await accepts('\u0085　'), false, 'Unicode white space is blank');
  }
});

test('execute accepts an absent or null call ID and rejects one that is not a string', async () => {
  const schema = asSchema<unknown>(createVacpAgentTools(silentTransport).vacp_execute.inputSchema);
  const accepts = async (callId: unknown) =>
    (await schema.validate!({ name: 'set', narration: 'Setting the value.', call_id: callId })).success;
  assert.equal(await accepts(undefined), true);
  assert.equal(await accepts(null), true);
  assert.equal(await accepts(' c1 '), true);
  assert.equal(await accepts(7), false);
});

test('every step reaches the transport with its input and the request’s abort signal', async () => {
  const calls: unknown[][] = [];
  const tools = createVacpAgentTools({
    ...silentTransport,
    vacp_execute: async (input, signal) => {
      calls.push([input, signal]);
      return { callId: 'c1', ok: true };
    },
  });
  const controller = new AbortController();
  const input = { name: 'set_sex', params: { sex: 'female' }, narration: 'Keeping only female athletes.' };
  await tools.vacp_execute.execute!(input, { ...context, abortSignal: controller.signal });
  assert.deepEqual(calls, [[input, controller.signal]]);
});

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

/** A page runtime with one action, reached through the transport an application wires. */
function page() {
  const provider: VacpProvider = {
    source: { id: 'vacp-source://steps', type: 'test', title: 'Steps' },
    subscribe: () => () => {},
    observe: () => ({
      revision: 'static',
      observedAt: '',
      graph: {
        nodes: [{ ref: 'vacp://steps/value', kind: 'Param', layer: 'ConfigLayer' }],
        edges: [],
        actions: [{ name: 'set', description: 'Set', operation: { kind: 'mutation' } }],
      },
      state: { 'vacp://steps/value': 0 },
    }),
    prepare: async (call) => ({ intent: { affects: [] }, execute: async () => ({ callId: call.callId, ok: true }) }),
  };
  const runtime = createVacpRuntime({ providers: [provider] });
  const turns = () => runtime.getProvenance().records.filter((record) => record.kind === 'turn');
  return { runtime, transport: createVacpTransport(runtime), turns };
}

const call = (toolName: string, input: unknown) => ({
  type: 'tool-call' as const,
  toolCallId: toolName,
  toolName,
  input: JSON.stringify(input),
});

test('an agent that acts before it narrates produces exactly one turn', async (t) => {
  const { runtime, transport, turns } = page();
  t.after(() => runtime.dispose());
  const steps = [
    [call('vacp_execute', { name: 'set', narration: 'Setting the value.' })],
    [call('vacp_progress', { message: 'The value is set.', done: true })],
  ];
  let calls = 0;
  const agent = createVacpToolLoopAgent({
    model: new MockLanguageModelV4({
      doGenerate: async () => {
        const content = steps[calls++];
        return content
          ? { content, finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage, warnings: [] }
          : {
              content: [{ type: 'text', text: 'Done.' }],
              finishReason: { unified: 'stop', raw: 'stop' },
              usage,
              warnings: [],
            };
      },
    }),
    transport,
  });
  await agent.generate({ prompt: 'Set the value.' });
  assert.deepEqual(
    turns().map((turn) => turn.kind === 'turn' && [turn.outcome, turn.message]),
    [['completed', 'The value is set.']],
  );
});

function chatModel(steps: unknown[][], last: 'stop' | 'fail' | 'abort', abort: AbortController) {
  let calls = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const content = steps[calls++];
      if (!content && last === 'fail') throw new Error('provider unavailable');
      if (!content && last === 'abort') {
        abort.abort();
        throw new DOMException('The request was aborted', 'AbortError');
      }
      return {
        stream: simulateReadableStream({
          chunks: content
            ? [
                { type: 'stream-start', warnings: [] },
                ...content,
                { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
              ]
            : [
                { type: 'stream-start', warnings: [] },
                { type: 'text-start', id: 't' },
                { type: 'text-delta', id: 't', delta: 'Done.' },
                { type: 'text-end', id: 't' },
                { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
              ],
        }) as never,
      };
    },
  });
}

async function chat(transport: ReturnType<typeof createVacpChatRuntime>['transport'], abort: AbortController) {
  const stream = await transport.sendMessages({
    trigger: 'submit-message',
    chatId: 'chat',
    messageId: undefined,
    messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'How many rows?' }] }],
    abortSignal: abort.signal,
  });
  const reader = stream.getReader();
  while (!(await reader.read()).done);
}

test('a chat request is one turn that the model’s sentences and steps join', async (t) => {
  const { runtime, transport, turns } = page();
  t.after(() => runtime.dispose());
  const abort = new AbortController();
  const steps = [
    [call('vacp_progress', { message: 'Looking at the value.' })],
    [call('vacp_execute', { name: 'set', narration: 'Setting the value.' })],
    [call('vacp_progress', { message: 'The value is set.', done: true })],
  ];
  const chatRuntime = createVacpChatRuntime({
    model: chatModel(steps, 'stop', abort),
    transport,
    activity: { control: runtime },
  });
  await chat(chatRuntime.transport, abort);
  const actions = runtime.getProvenance().records.filter((record) => record.kind === 'action');
  assert.deepEqual(
    turns().map((turn) => turn.kind === 'turn' && [turn.outcome, turn.opening, turn.message]),
    [['completed', 'Looking at the value.', 'The value is set.']],
  );
  const [turn] = turns();
  assert.equal(
    actions[0]?.kind === 'action' && actions[0].execution.activityId,
    turn?.kind === 'turn' && turn.activityId,
  );
});

test('a chat request’s outcome closes its turn when the model never closes it', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const [last, outcome] of [
    ['stop', 'completed'],
    ['fail', 'failed'],
    ['abort', 'cancelled'],
  ] as const) {
    const { runtime, transport, turns } = page();
    const abort = new AbortController();
    const chatRuntime = createVacpChatRuntime({
      model: chatModel([[call('vacp_progress', { message: 'Looking at the data.' })]], last, abort),
      transport,
      activity: { control: runtime },
      maxRetries: 0,
    });
    await chat(chatRuntime.transport, abort);
    assert.deepEqual(
      turns().map((turn) => turn.kind === 'turn' && turn.outcome),
      [outcome],
      last,
    );
    runtime.dispose();
  }
});

test('the agent reads the shared tool guidance unless its host gives instructions', async () => {
  const systems: unknown[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      systems.push(options.prompt.find((message) => message.role === 'system')?.content);
      return {
        content: [{ type: 'text', text: 'Done.' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage,
        warnings: [],
      };
    },
  });
  await createVacpToolLoopAgent({ model, transport: silentTransport }).generate({ prompt: 'Hi' });
  await createVacpToolLoopAgent({ model, transport: silentTransport, instructions: 'Answer briefly.' }).generate({
    prompt: 'Hi',
  });
  assert.equal(systems[0], defaultVacpAgentInstructions);
  assert.ok(defaultVacpAgentInstructions.includes(vacpAgentToolGuidance));
  assert.equal(systems[1], 'Answer briefly.');
});

test('progress publishes 251 emoji unchanged through a real runtime', async (t) => {
  const { runtime, transport, turns } = page();
  t.after(() => runtime.dispose());
  const message = '😀'.repeat(251);
  await transport.vacp_progress({ message });
  assert.equal(runtime.getAgentActivities()[0]?.summary, message);
  await transport.vacp_progress({ message, done: true });
  assert.equal(turns()[0]?.message, message);
});

test('progress publishes the shared whitespace fixtures unchanged through a real runtime', async (t) => {
  const fixtures: { cases: Array<{ input: unknown; expected?: string }> } = JSON.parse(
    readFileSync(new URL('../../protocol/test/fixtures/narration.json', import.meta.url), 'utf8'),
  );
  const { runtime, transport, turns } = page();
  t.after(() => runtime.dispose());
  for (const fixture of fixtures.cases) {
    if (fixture.expected === undefined || typeof fixture.input !== 'string') continue;
    await transport.vacp_progress({ message: fixture.input });
    assert.equal(runtime.getAgentActivities()[0]?.summary, fixture.expected);
    await transport.vacp_progress({ message: fixture.input, done: true });
    assert.equal(turns().at(-1)?.message, fixture.expected);
  }
});

for (const method of ['generate', 'stream'] as const) {
  for (const outcome of ['completed', 'failed', 'cancelled'] as const) {
    test(`standalone ${method} closes a ${outcome} request and starts a separate second turn`, async (t) => {
      t.mock.method(console, 'error', () => {});
      const { runtime, transport, turns } = page();
      t.after(() => runtime.dispose());
      let request = 0;
      const abort = new AbortController();
      const action = call('vacp_execute', { name: 'set', narration: 'Setting the value.' });
      const response = () => {
        if (request++ === 1 && outcome === 'failed') throw new Error('provider unavailable');
        if (request === 2 && outcome === 'cancelled') {
          abort.abort();
          throw new DOMException('The request was aborted', 'AbortError');
        }
        return {
          content: [action],
          finishReason: { unified: 'tool-calls' as const, raw: 'tool_calls' },
          usage,
          warnings: [],
        };
      };
      const model = new MockLanguageModelV4({
        doGenerate: async () => response(),
        doStream: async () => {
          response();
          return {
            stream: simulateReadableStream({
              chunks: [
                { type: 'stream-start', warnings: [] },
                action,
                { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
              ],
            }),
          };
        },
      });
      const agent = createVacpToolLoopAgent({
        model,
        transport,
        maxSteps: outcome === 'completed' ? 1 : 2,
        maxRetries: 0,
        activity: { control: runtime },
      });
      const run = async (signal?: AbortSignal) => {
        if (method === 'generate') return agent.generate({ prompt: 'Set the value.', abortSignal: signal });
        const result = await agent.stream({ prompt: 'Set the value.', abortSignal: signal });
        await result.consumeStream();
      };
      if (method === 'generate' && outcome !== 'completed') await assert.rejects(run(abort.signal));
      else await run(abort.signal);
      assert.deepEqual(
        turns().map((turn) => turn.outcome),
        [outcome],
      );
      assert.equal(runtime.getProvenance().records.filter((record) => record.kind === 'action').length, 1);
      assert.equal(runtime.getAgentActivities().length, 0);
      await run();
      assert.deepEqual(
        turns().map((turn) => turn.outcome),
        [outcome, 'completed'],
      );
      assert.notEqual(turns()[0]?.activityId, turns()[1]?.activityId);
    });
  }
}
