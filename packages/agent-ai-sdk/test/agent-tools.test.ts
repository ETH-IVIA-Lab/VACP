import assert from 'node:assert/strict';
import test from 'node:test';

import { vacpAgentTools, type VacpAgentActivityControl } from '@vacp/protocol';
import type { VacpTransport } from '@vacp/transport-bridge';
import { asSchema, simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

import { createVacpAgentTools, createVacpChatRuntime, createVacpToolLoopAgent } from '../src/index';

const actor = { id: 'agent', kind: 'agent' as const, label: 'Assistant' };
const context = { toolCallId: 'call', messages: [] };

function recordingTransport() {
  const calls: Array<{ tool: string; args: unknown[] }> = [];
  const transport: VacpTransport = {
    vacp_observe: async () => ({}) as never,
    vacp_capabilities: async (...args) => {
      calls.push({ tool: 'vacp_capabilities', args });
      return {} as never;
    },
    vacp_state: async (...args) => {
      calls.push({ tool: 'vacp_state', args });
      return {} as never;
    },
    vacp_execute: async (...args) => {
      calls.push({ tool: 'vacp_execute', args });
      return { callId: args[2] ?? 'call', ok: true };
    },
  };
  return { transport, calls };
}

function recordingActivity() {
  const outcomes: string[] = [];
  const activity: Pick<VacpAgentActivityControl, 'beginAgentActivity'> = {
    beginAgentActivity: () => ({ update() {}, end: (end) => outcomes.push(end?.outcome ?? 'completed') }),
  };
  return { activity, outcomes };
}

test('the agent tools carry the names, descriptions, and input fields every transport offers', async () => {
  const { tools } = createVacpAgentTools({
    transport: recordingTransport().transport,
    activity: recordingActivity().activity,
  });
  assert.deepEqual(Object.keys(tools).sort(), Object.keys(vacpAgentTools).sort());
  for (const [name, contract] of Object.entries(vacpAgentTools)) {
    const tool = tools[name as keyof typeof tools]!;
    assert.equal(tool.description, contract.description);
    const schema = (await asSchema(tool.inputSchema).jsonSchema) as { properties?: Record<string, unknown> };
    assert.deepEqual(Object.keys(schema.properties ?? {}).sort(), [...contract.input].sort());
  }
});

test('execution carries the actor and the step sentence', async () => {
  const { transport, calls } = recordingTransport();
  const { tools } = createVacpAgentTools({ transport, actor });
  await tools.vacp_execute.execute!(
    { name: 'chart.set', params: { value: 2 }, narration: 'Setting two.', call_id: 'c1' },
    context,
  );
  assert.deepEqual(calls, [
    { tool: 'vacp_execute', args: ['chart.set', { value: 2 }, 'c1', { actor, narration: 'Setting two.' }] },
  ]);
  assert.equal('vacp_progress' in tools, false, 'progress needs the host activity channel');
});

function progressModel(finish: 'stop' | 'fail') {
  const usage = {
    inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  };
  let calls = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      calls++;
      if (calls === 1)
        return {
          content: [
            {
              type: 'tool-call',
              toolCallId: 'p',
              toolName: 'vacp_progress',
              input: '{"message":"Looking at the data."}',
            },
          ],
          finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
          usage,
          warnings: [],
        };
      if (finish === 'fail') throw new Error('provider unavailable');
      return {
        content: [{ type: 'text', text: 'Done.' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage,
        warnings: [],
      };
    },
  });
}

test('a request closes the turn the model opened, as completed or as failed', async () => {
  for (const [finish, outcome] of [
    ['stop', 'completed'],
    ['fail', 'failed'],
  ] as const) {
    const { activity, outcomes } = recordingActivity();
    const agent = createVacpToolLoopAgent({
      model: progressModel(finish),
      transport: recordingTransport().transport,
      activity: activity as VacpAgentActivityControl,
      maxRetries: 0,
    });
    const request = agent.generate({ prompt: 'How many rows?' });
    if (finish === 'fail') await assert.rejects(request, /provider unavailable/);
    else await request;
    assert.deepEqual(outcomes, [outcome]);
  }
});

function streamingProgressModel(second: 'stop' | 'fail' | 'abort', abort: AbortController) {
  const usage = {
    inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  };
  let calls = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      calls++;
      if (calls === 2 && second === 'fail') throw new Error('provider unavailable');
      if (calls === 2 && second === 'abort') {
        abort.abort();
        throw new DOMException('The request was aborted', 'AbortError');
      }
      return {
        stream: simulateReadableStream({
          chunks:
            calls === 1
              ? ([
                  { type: 'stream-start', warnings: [] },
                  {
                    type: 'tool-call',
                    toolCallId: 'p',
                    toolName: 'vacp_progress',
                    input: '{"message":"Looking at the data."}',
                  },
                  { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
                ] as const)
              : ([
                  { type: 'stream-start', warnings: [] },
                  { type: 'text-start', id: 't' },
                  { type: 'text-delta', id: 't', delta: 'Done.' },
                  { type: 'text-end', id: 't' },
                  { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
                ] as const),
        }),
      };
    },
  });
}

test('a streamed request closes the turn the model opened as completed, failed, or cancelled', async (t) => {
  // streamText logs a failed stream to the console, and agent streams take no onError to replace it.
  t.mock.method(console, 'error', () => {});
  for (const [second, outcome] of [
    ['stop', 'completed'],
    ['fail', 'failed'],
    ['abort', 'cancelled'],
  ] as const) {
    const { activity, outcomes } = recordingActivity();
    const abort = new AbortController();
    const agent = createVacpToolLoopAgent({
      model: streamingProgressModel(second, abort),
      transport: recordingTransport().transport,
      activity: activity as VacpAgentActivityControl,
      maxRetries: 0,
    });
    const result = await agent.stream({ prompt: 'How many rows?', abortSignal: abort.signal });
    await result.consumeStream({ onError: () => {} });
    assert.deepEqual(outcomes, [outcome], second);
  }
});

test('a chat request closes its turn as the agent request ends', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const [second, outcome] of [
    ['stop', 'completed'],
    ['fail', 'failed'],
    ['abort', 'cancelled'],
  ] as const) {
    const { activity, outcomes } = recordingActivity();
    const abort = new AbortController();
    const { transport } = createVacpChatRuntime({
      model: streamingProgressModel(second, abort),
      transport: recordingTransport().transport,
      activity: activity as VacpAgentActivityControl,
      maxRetries: 0,
    });
    const stream = await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat',
      messageId: undefined,
      messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'How many rows?' }] }],
      abortSignal: abort.signal,
    });
    const reader = stream.getReader();
    while (!(await reader.read()).done);
    assert.deepEqual(outcomes, [outcome], second);
  }
});

test('a streamed request that fails before its first step closes the turn the model opened', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { activity, outcomes } = recordingActivity();
  const agent = createVacpToolLoopAgent({
    model: new MockLanguageModelV4({
      doStream: async () => {
        throw new Error('provider unavailable');
      },
    }),
    transport: recordingTransport().transport,
    activity: activity as VacpAgentActivityControl,
    maxRetries: 0,
  });
  // A turn the model opened through vacp_progress, as the progress tool opens it.
  await agent.tools.vacp_progress!.execute!({ message: 'Looking at the data.', done: false }, context);
  const result = await agent.stream({ prompt: 'How many rows?' });
  await result.consumeStream({ onError: () => {} });
  await assert.rejects(result.text);
  assert.deepEqual(outcomes, ['failed']);
});
