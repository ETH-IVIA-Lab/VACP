import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import type { VacpAgentActivityControl } from '@vacp/protocol';

import { withAgentActivity } from '../src/activity-transport';

const actor = { id: 'agent', kind: 'agent' as const, label: 'Agent' };

/** Records what a presence viewer would see: each published summary and the first outcome per turn. */
function recordingControl(options: { failBegin?: boolean } = {}) {
  const shown: string[] = [];
  const outcomes: string[] = [];
  const control: Pick<VacpAgentActivityControl, 'beginAgentActivity'> = {
    beginAgentActivity(begin) {
      if (options.failBegin) throw new Error('activity channel disposed');
      let ended = false;
      if (begin.summary) shown.push(begin.summary);
      return {
        update: (summary) => {
          if (!ended) shown.push(summary);
        },
        end: (end) => {
          if (ended) return;
          ended = true;
          outcomes.push(end?.outcome ?? 'completed');
          if (end?.summary) shown.push(end.summary);
        },
      };
    },
  };
  return { control, shown, outcomes };
}
function streaming(chunks: UIMessageChunk[], fail?: Error): ChatTransport<UIMessage> {
  return {
    reconnectToStream: async () => null,
    sendMessages: async () =>
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          if (fail) controller.error(fail);
          else controller.close();
        },
      }),
  };
}
const request: Parameters<ChatTransport<UIMessage>['sendMessages']>[0] = {
  trigger: 'submit-message',
  chatId: 'test',
  messageId: undefined,
  messages: [],
  abortSignal: undefined,
};
async function drain(stream: ReadableStream<UIMessageChunk>) {
  const reader = stream.getReader();
  const chunks: UIMessageChunk[] = [];
  while (true) {
    const next = await reader.read();
    if (next.done) return chunks;
    chunks.push(next.value);
  }
}

test('a turn starts silently, shows no wording the model did not write, and forwards every chunk unchanged', async () => {
  const { control, shown, outcomes } = recordingControl();
  const chunks: UIMessageChunk[] = [
    { type: 'reasoning-start', id: 'r' },
    { type: 'reasoning-delta', id: 'r', delta: 'private reasoning' },
    { type: 'tool-input-start', toolCallId: 'call', toolName: 'vacp_state' },
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: 'Visible response' },
  ];
  const result = await drain(await withAgentActivity(streaming(chunks), control, actor).sendMessages(request));
  assert.deepEqual(result, chunks);
  assert.deepEqual(shown, []);
  assert.deepEqual(outcomes, ['completed']);
});

test('a chat request that reports an error or an abort ends its turn with that outcome', async () => {
  const { control, outcomes } = recordingControl();
  const wrapped = withAgentActivity(streaming([{ type: 'error', errorText: 'provider unavailable' }]), control, actor);
  await drain(await wrapped.sendMessages(request));
  await drain(await withAgentActivity(streaming([{ type: 'abort' }]), control, actor).sendMessages(request));
  assert.deepEqual(outcomes, ['failed', 'cancelled']);
});

test('a chat request that breaks before or while it streams ends the turn as failed', async () => {
  const { control, outcomes } = recordingControl();
  await assert.rejects(
    drain(await withAgentActivity(streaming([], new Error('network')), control, actor).sendMessages(request)),
  );
  const rejecting: ChatTransport<UIMessage> = {
    reconnectToStream: async () => null,
    sendMessages: async () => {
      throw new Error('offline');
    },
  };
  await assert.rejects(withAgentActivity(rejecting, control, actor).sendMessages(request), /offline/);
  assert.deepEqual(outcomes, ['failed', 'failed']);
});

test('a consumer cancellation ends the turn as cancelled, and a disposed activity channel never blocks chat', async () => {
  const { control, outcomes } = recordingControl();
  const stream = await withAgentActivity(streaming([{ type: 'text-start', id: 't' }]), control, actor).sendMessages(
    request,
  );
  await stream.cancel('user stopped');
  assert.deepEqual(outcomes, ['cancelled']);
  const chunks: UIMessageChunk[] = [{ type: 'text-start', id: 't' }];
  const disposed = recordingControl({ failBegin: true });
  const passthrough = await withAgentActivity(streaming(chunks), disposed.control, actor).sendMessages(request);
  assert.deepEqual(await drain(passthrough), chunks);
});
