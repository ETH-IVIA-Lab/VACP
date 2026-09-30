import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import type { VacpAgentActivityControl } from '@vacp/protocol';

const actor = { id: 'agent', kind: 'agent' as const, label: 'Assistant' };
import { withAgentActivity } from '../src/activity-transport';
import { createAgentTurns } from '../src/agent-turn';
import { buildVacpAgentTools, createVacpAgentTools } from '../src/vacp-tools';

const silent = {
  vacp_observe: async () => ({}) as never,
  vacp_capabilities: async () => ({}) as never,
  vacp_state: async () => ({}) as never,
  vacp_execute: async () => ({ callId: 'call', ok: true }),
};

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

test('a turn starts silently, shows no wording the model did not write, and forwards every chunk unchanged', async () => {
  const { control, shown, outcomes } = recordingControl();
  const chunks: UIMessageChunk[] = [
    { type: 'reasoning-start', id: 'r' },
    { type: 'reasoning-delta', id: 'r', delta: 'private reasoning' },
    { type: 'tool-input-start', id: 'call', toolName: 'vacp_state' },
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: 'Visible response' },
  ];
  const wrapped = withAgentActivity(streaming(chunks), createAgentTurns(control, actor));
  const result = await drain(await wrapped.sendMessages(request));
  assert.deepEqual(result, chunks);
  assert.deepEqual(shown, []);
  assert.deepEqual(outcomes, ['completed']);
});

test('only what the model tells the person through vacp_progress is shown', async () => {
  const { control, shown, outcomes } = recordingControl();
  const { tools, turns } = buildVacpAgentTools({ transport: silent, activity: control, actor });
  const vacp_progress = tools.vacp_progress!;
  const chunks: UIMessageChunk[] = [
    { type: 'tool-input-start', id: 'a', toolName: 'vacp_progress' },
    { type: 'tool-input-start', id: 'b', toolName: 'vacp_execute' },
    { type: 'text-start', id: 't' },
  ];
  const stream = await withAgentActivity(streaming(chunks), turns!).sendMessages(request);
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
  const vacp_progress = createVacpAgentTools({ transport: silent, activity: control, actor }).tools.vacp_progress!;
  const context = { toolCallId: 'p', messages: [] };
  await vacp_progress.execute!({ message: 'Looking at the age spread', done: false }, context);
  await vacp_progress.execute!({ message: 'Most medalists are 22 to 28.', done: true }, context);
  assert.deepEqual(shown, ['Looking at the age spread', 'Most medalists are 22 to 28.']);
  assert.deepEqual(outcomes, ['completed']);
});

test('stream errors, aborts and transport failures end the turn with their outcome', async () => {
  const { control, outcomes } = recordingControl();
  const turns = createAgentTurns(control, actor);
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
  const vacp_progress = createVacpAgentTools({ transport: silent, activity: disposed.control, actor }).tools
    .vacp_progress!;
  const context = { toolCallId: 'p', messages: [] };
  const result = await vacp_progress.execute!({ message: 'Looking at the age spread', done: false }, context);
  assert.equal(result.ok, false);
  assert.match(String(result.reason), /not being shown/);
  const live = recordingControl();
  const shown = createVacpAgentTools({ transport: silent, activity: live.control, actor }).tools.vacp_progress!;
  assert.deepEqual(await shown.execute!({ message: 'Looking at the age spread', done: false }, context), { ok: true });
});

test('a consumer cancellation ends the turn as cancelled, and a disposed activity channel never blocks chat', async () => {
  const { control, outcomes } = recordingControl();
  const stream = await withAgentActivity(
    streaming([{ type: 'text-start', id: 't' }]),
    createAgentTurns(control, actor),
  ).sendMessages(request);
  await stream.cancel('user stopped');
  assert.deepEqual(outcomes, ['cancelled']);
  const chunks: UIMessageChunk[] = [{ type: 'text-start', id: 't' }];
  const disposed = recordingControl({ failBegin: true });
  const passthrough = await withAgentActivity(
    streaming(chunks),
    createAgentTurns(disposed.control, actor),
  ).sendMessages(request);
  const reader = passthrough.getReader();
  assert.deepEqual((await reader.read()).value, chunks[0]);
});

test('every vacp_execute step carries its own sentence and the agent that narrates the turn', async () => {
  const { control, shown } = recordingControl();
  const executed: Array<{ name: string; options?: unknown }> = [];
  const transport = {
    vacp_observe: async () => ({}) as never,
    vacp_capabilities: async () => ({}) as never,
    vacp_state: async () => ({}) as never,
    vacp_execute: async (name: string, _params?: unknown, callId?: string, options?: unknown) => {
      executed.push({ name, options });
      return { callId: callId ?? 'call', ok: true };
    },
  };
  const { vacp_execute } = createVacpAgentTools({ transport, activity: control, actor }).tools;
  const context = { toolCallId: 'e', messages: [] };
  await vacp_execute.execute!({ name: 'set_sex', narration: 'Keeping only female athletes.' }, context);
  await vacp_execute.execute!({ name: 'set_sports', narration: 'Comparing swimmers with gymnasts.' }, context);
  assert.deepEqual(shown, [], 'a step keeps its sentence and leaves the turn words alone');
  assert.deepEqual(executed, [
    { name: 'set_sex', options: { actor, narration: 'Keeping only female athletes.' } },
    { name: 'set_sports', options: { actor, narration: 'Comparing swimmers with gymnasts.' } },
  ]);
});
