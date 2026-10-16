import assert from 'node:assert/strict';
import test from 'node:test';

import { safeValidateUIMessages, type UIMessage } from 'ai';

import { wrapTransportWithVacpContextCompaction } from '../src/context-compaction';

function toolMessage(id: string, toolCallId: string, n: number): UIMessage {
  return {
    id,
    role: 'assistant',
    parts: [
      { type: 'step-start' },
      {
        type: 'tool-vacp_state',
        toolCallId,
        state: 'output-available',
        input: { refs: ['vacp://x'], n },
        output: { ok: true, n },
      },
      { type: 'text', text: `assistant-${n}` },
    ],
  };
}

test('wrapTransportWithVacpContextCompaction keeps recent tool payloads and compacts old ones', async () => {
  const captured: UIMessage[][] = [];

  const transport = {
    sendMessages: async (options: any) => {
      captured.push(options.messages);

      return new ReadableStream();
    },
    reconnectToStream: async () => null,
  };

  const wrapped = wrapTransportWithVacpContextCompaction(
    transport,
    {
      enabled: true,
      maxTurns: 1,
      preserveFullToolPayloadTurns: 1,
      preserveReasoningTurns: 0,
      maxTextCharsPerPart: 500,
      maxToolJsonCharsPerPart: 500,
    },
    {
      availableToolNames: ['vacp_capabilities', 'vacp_state', 'vacp_execute'],
    },
  );

  const messages: UIMessage[] = [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'first question' }] },
    toolMessage('a1', 'c1', 1),
    { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'second question' }] },
    toolMessage('a2', 'c2', 2),
  ];

  await wrapped.sendMessages({
    trigger: 'submit-message',
    chatId: 'chat-1',
    messageId: undefined,
    messages,
    abortSignal: undefined,
  });

  const compacted = captured[0]!;
  const oldAssistant = compacted[1]!;
  assert.equal(oldAssistant.role, 'assistant');
  assert.equal(
    oldAssistant.parts.some((part) => part.type === 'tool-vacp_state'),
    false,
  );
  assert.equal(
    oldAssistant.parts.some((part) => part.type === 'text'),
    true,
  );

  const recentAssistant = compacted[3]!;
  assert.equal(
    recentAssistant.parts.some((part) => part.type === 'tool-vacp_state'),
    true,
  );
});

test('wrapTransportWithVacpContextCompaction is a no-op when disabled', async () => {
  let seen: UIMessage[] = [];

  const transport = {
    sendMessages: async (options: any) => {
      seen = options.messages;

      return new ReadableStream();
    },
    reconnectToStream: async () => null,
  };

  const wrapped = wrapTransportWithVacpContextCompaction(transport, { enabled: false });
  const messages: UIMessage[] = [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }];
  await wrapped.sendMessages({
    trigger: 'submit-message',
    chatId: 'chat-1',
    messageId: undefined,
    messages,
    abortSignal: undefined,
  });
  assert.equal(seen, messages);
});

test('wrapTransportWithVacpContextCompaction bounds recent tool payloads before transport send', async () => {
  let seen: UIMessage[] = [];

  const transport = {
    sendMessages: async (options: any) => {
      seen = options.messages;

      return new ReadableStream();
    },
    reconnectToStream: async () => null,
  };

  const wrapped = wrapTransportWithVacpContextCompaction(transport, {
    enabled: true,
    maxTurns: 8,
    preserveFullToolPayloadTurns: 2,
    preserveReasoningTurns: 1,
  });

  const when = new Date('2026-03-05T12:34:56.000Z');

  const messages: UIMessage[] = [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    {
      id: 'a1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-vacp_state',
          toolCallId: 'state-1',
          state: 'output-available',
          input: { at: when, skip: undefined },
          output: { values: [1, undefined, when] },
        },
      ],
    },
  ];

  await wrapped.sendMessages({
    trigger: 'submit-message',
    chatId: 'chat-1',
    messageId: undefined,
    messages,
    abortSignal: undefined,
  });

  const toolPart = seen[1]!.parts[0];
  assert.ok(toolPart && toolPart.type === 'tool-vacp_state');
  assert.deepEqual(toolPart.input, { at: '2026-03-05T12:34:56.000Z' });
  assert.deepEqual(toolPart.output, { values: [1, null, '2026-03-05T12:34:56.000Z'] });
});

test('a tool part that failed or never finished replays as a valid message', async () => {
  let seen: UIMessage[] = [];
  const transport = {
    sendMessages: async (options: any) => {
      seen = options.messages;
      return new ReadableStream();
    },
    reconnectToStream: async () => null,
  };
  const wrapped = wrapTransportWithVacpContextCompaction(transport, { enabled: true });
  const messages: UIMessage[] = [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
    {
      id: 'a1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-vacp_state',
          toolCallId: 'failed',
          state: 'output-error',
          input: { refs: ['app/chart'] },
          output: undefined,
          rawInput: undefined,
          errorText: 'Invalid input',
        },
        { type: 'tool-vacp_state', toolCallId: 'aborted', state: 'input-available', input: {}, output: undefined },
      ] as UIMessage['parts'],
    },
  ];
  await wrapped.sendMessages({
    trigger: 'submit-message',
    chatId: 'chat-1',
    messageId: undefined,
    messages,
    abortSignal: undefined,
  });
  assert.equal((await safeValidateUIMessages({ messages: seen })).success, true);
});

test('wrapTransportWithVacpContextCompaction augments invalid prompt errors with recent message summaries', async () => {
  const transport = {
    sendMessages: async () => {
      throw new Error('The messages do not match the ModelMessage[] schema.');
    },
    reconnectToStream: async () => null,
  };

  const wrapped = wrapTransportWithVacpContextCompaction(transport, { enabled: true });

  await assert.rejects(
    wrapped.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat-1',
      messageId: undefined,
      abortSignal: undefined,
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
        {
          id: 'a1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-vacp_state',
              toolCallId: 'state-1',
              state: 'output-available',
              input: { value: 1 },
              output: { value: 2 },
            },
          ],
        },
      ] satisfies UIMessage[],
    }),
    (cause: unknown) =>
      cause instanceof Error &&
      cause.message.includes('Chat prompt validation failed after compaction.') &&
      cause.message.includes('assistant:a1:tool-vacp_state'),
  );
});

test('wrapTransportWithVacpContextCompaction summarizes recent unavailable tool parts instead of replaying them', async () => {
  let seen: UIMessage[] = [];

  const transport = {
    sendMessages: async (options: any) => {
      seen = options.messages;

      return new ReadableStream();
    },
    reconnectToStream: async () => null,
  };

  const wrapped = wrapTransportWithVacpContextCompaction(
    transport,
    {
      enabled: true,
      maxTurns: 8,
      preserveFullToolPayloadTurns: 2,
      preserveReasoningTurns: 1,
    },
    {
      availableToolNames: ['vacp_capabilities', 'vacp_state', 'vacp_execute'],
    },
  );

  const messages: UIMessage[] = [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'first question' }] },
    {
      id: 'a1',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'vacp.data_sql',
          toolCallId: 'sql-1',
          state: 'output-error',
          input: undefined,
          errorText: "Model tried to call unavailable tool 'vacp.data_sql'.",
        },
        { type: 'text', text: 'Fallback explanation.' },
      ],
    },
    { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'follow-up question' }] },
  ];

  await wrapped.sendMessages({
    trigger: 'submit-message',
    chatId: 'chat-1',
    messageId: undefined,
    messages,
    abortSignal: undefined,
  });

  const assistant = seen[1]!;
  assert.equal(
    assistant.parts.some((part) => part.type === 'dynamic-tool'),
    false,
  );
  assert.equal(
    assistant.parts.some((part) => part.type === 'text' && 'text' in part && part.text.includes('Tool vacp.data_sql')),
    true,
  );
});
