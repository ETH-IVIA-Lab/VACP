import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import type { VacpAgentActivityControl } from '@vacp/protocol';
import { withAgentActivity } from '../src/activity-transport';
import { createAgentTurns } from '../src/agent-turn';
import { createVacpProgressTool } from '../src/vacp-tools';

/** Records what a presence viewer would see: each published summary and the first outcome per turn. */
function recordingControl(options: { failBegin?: boolean } = {}) {
  const shown: string[] = [];
  const outcomes: string[] = [];
  const control: VacpAgentActivityControl = {
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
const request = { trigger: 'submit-message', chatId: 'test', messages: [], abortSignal: undefined } as const;
async function drain(stream: ReadableStream<UIMessageChunk>, onChunk?: (chunk: UIMessageChunk) => Promise<void>) {
  const reader = stream.getReader();
  const chunks: UIMessageChunk[] = [];
  while (true) {
    const next = await reader.read();
    if (next.done) return chunks;
    chunks.push(next.value);
    await onChunk?.(next.value);
  }
}

test('a turn starts silently, fills gaps with lifecycle wording, and forwards every chunk unchanged', async () => {
  const { control, shown, outcomes } = recordingControl();
  const chunks: UIMessageChunk[] = [
    { type: 'reasoning-start', id: 'r' },
    { type: 'reasoning-delta', id: 'r', delta: 'private reasoning' },
    { type: 'tool-input-start', id: 'call', toolName: 'vacp_state' },
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: 'Visible response' },
  ];
  const wrapped = withAgentActivity(streaming(chunks), createAgentTurns(control));
  const result = await drain(await wrapped.sendMessages(request));
  assert.deepEqual(result, chunks);
  assert.deepEqual(shown, ['Checking the view', 'Writing up what changed']);
  assert.deepEqual(outcomes, ['completed']);
});

test('what the model tells the person through vacp_progress is never overwritten by lifecycle wording', async () => {
  const { control, shown, outcomes } = recordingControl();
  const turns = createAgentTurns(control);
  const { vacp_progress } = createVacpProgressTool(turns.progress);
  const chunks: UIMessageChunk[] = [
    { type: 'tool-input-start', id: 'a', toolName: 'vacp_progress' },
    { type: 'tool-input-start', id: 'b', toolName: 'vacp_execute' },
    { type: 'text-start', id: 't' },
  ];
  const stream = await withAgentActivity(streaming(chunks), turns).sendMessages(request);
  await drain(stream, async (chunk) => {
    if (chunk.type === 'tool-input-start' && chunk.toolName === 'vacp_progress')
      await vacp_progress.execute!(
        { message: 'Narrowing to sprinters under 25', done: false },
        { toolCallId: 'a', messages: [] },
      );
  });
  assert.deepEqual(shown, ['Narrowing to sprinters under 25']);
  assert.deepEqual(outcomes, ['completed']);
});

test('vacp_progress opens its own turn without a chat transport and done closes it with the closing sentence', async () => {
  const { control, shown, outcomes } = recordingControl();
  const { vacp_progress } = createVacpProgressTool(createAgentTurns(control).progress);
  const context = { toolCallId: 'p', messages: [] };
  await vacp_progress.execute!({ message: 'Looking at the age spread', done: false }, context);
  await vacp_progress.execute!({ message: 'Most medalists are 22 to 28.', done: true }, context);
  assert.deepEqual(shown, ['Looking at the age spread', 'Most medalists are 22 to 28.']);
  assert.deepEqual(outcomes, ['completed']);
});

test('stream errors, aborts and transport failures end the turn with their outcome', async () => {
  const { control, outcomes } = recordingControl();
  const turns = createAgentTurns(control);
  await drain(await withAgentActivity(streaming([{ type: 'error', errorText: 'boom' }]), turns).sendMessages(request));
  await drain(await withAgentActivity(streaming([{ type: 'abort' }]), turns).sendMessages(request));
  await assert.rejects(
    drain(await withAgentActivity(streaming([], new Error('network')), turns).sendMessages(request)),
  );
  const rejecting: ChatTransport<UIMessage> = {
    reconnectToStream: async () => null,
    sendMessages: async () => {
      throw new Error('offline');
    },
  };
  await assert.rejects(withAgentActivity(rejecting, turns).sendMessages(request), /offline/);
  assert.deepEqual(outcomes, ['failed', 'cancelled', 'failed', 'failed']);
});

test('vacp_progress tells the model when its words could not be shown', async () => {
  const disposed = recordingControl({ failBegin: true });
  const { vacp_progress } = createVacpProgressTool(createAgentTurns(disposed.control).progress);
  const context = { toolCallId: 'p', messages: [] };
  const result = await vacp_progress.execute!({ message: 'Looking at the age spread', done: false }, context);
  assert.equal(result.ok, false);
  assert.match(String(result.reason), /not being shown/);
  const live = recordingControl();
  const shown = createVacpProgressTool(createAgentTurns(live.control).progress).vacp_progress;
  assert.deepEqual(await shown.execute!({ message: 'Looking at the age spread', done: false }, context), { ok: true });
});

test('a consumer cancellation ends the turn as cancelled, and a disposed activity channel never blocks chat', async () => {
  const { control, outcomes } = recordingControl();
  const stream = await withAgentActivity(
    streaming([{ type: 'text-start', id: 't' }]),
    createAgentTurns(control),
  ).sendMessages(request);
  await stream.cancel('user stopped');
  assert.deepEqual(outcomes, ['cancelled']);
  const chunks: UIMessageChunk[] = [{ type: 'text-start', id: 't' }];
  const disposed = recordingControl({ failBegin: true });
  const passthrough = await withAgentActivity(streaming(chunks), createAgentTurns(disposed.control)).sendMessages(
    request,
  );
  const reader = passthrough.getReader();
  assert.deepEqual((await reader.read()).value, chunks[0]);
});
