import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { generateText, isStepCount, jsonSchema, tool, type Telemetry } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { createTracing, recordExecutions, traceRecorder } from '../src/adapters/telemetry';
import { Trace } from '../src/core/trace';
import { readJsonl } from '../src/results/store';

type SpanRow = {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  name: string;
  duration_ms: number;
  status: 'ok' | 'error';
  attributes: Record<string, unknown>;
  events: Array<{ name: string }>;
};

const usage = (input: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
});

const tracing = createTracing();

/** Run `work` inside an `eval.run` span routed to a fresh `spans.jsonl`, and read the file back. */
async function traced(work: () => Promise<void>) {
  const file = join(mkdtempSync(join(tmpdir(), 'vacp-evals-spans-')), 'spans.jsonl');
  await tracing.tracer.startActiveSpan('eval.run page/lookup', async (span) => {
    tracing.route(span.spanContext().traceId, file);
    try {
      await work();
    } finally {
      span.end();
    }
  });
  return readJsonl<SpanRow>(file);
}

test('a run’s AI SDK spans nest under its run span and carry the condition, without content by default', async () => {
  const trace = new Trace();
  const spans = await traced(async () => {
    await generateText({
      model: new MockLanguageModelV4({
        doGenerate: [
          {
            content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'lookup', input: '{"code":"SEA"}' }],
            finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
            usage: usage(100),
            warnings: [],
          },
          {
            content: [{ type: 'text', text: 'SEA has 56 routes.' }],
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: usage(150),
            warnings: [],
          },
        ],
      }),
      prompt: 'How many routes does SEA have?',
      tools: {
        lookup: tool({
          inputSchema: jsonSchema<{ code: string }>({ type: 'object', properties: { code: { type: 'string' } } }),
          execute: async ({ code }) => ({ code, routes: 56 }),
        }),
      },
      stopWhen: isStepCount(4),
      telemetry: {
        integrations: [tracing.otel, traceRecorder(trace)],
        functionId: 'webmcp',
        recordInputs: false,
        recordOutputs: false,
      },
    });
  });
  const byId = new Map(spans.map((span) => [span.span_id, span]));
  const run = spans.find((span) => span.name === 'eval.run page/lookup')!;
  const ancestors = (span: SpanRow): string[] => {
    const parent = span.parent_span_id ? byId.get(span.parent_span_id) : undefined;
    return parent ? [parent.name, ...ancestors(parent)] : [];
  };
  const execution = spans.find((span) => span.name === 'execute_tool lookup')!;
  assert.ok(ancestors(execution).includes(run.name), 'the tool span sits inside the run');
  assert.equal(spans.filter((span) => span.name.startsWith('chat ')).length, 2);
  assert.ok(spans.every((span) => span.trace_id === run.trace_id));
  const agent = spans.find((span) => span.name.startsWith('invoke_agent '))!;
  assert.equal(agent.attributes['gen_ai.agent.name'], 'webmcp');
  assert.equal(agent.attributes['gen_ai.usage.input_tokens'], 250);
  assert.ok(spans.every((span) => !('gen_ai.input.messages' in span.attributes)));
  assert.deepEqual(
    trace.turns.map((turn) => turn.role),
    ['tool_call', 'tool_result', 'assistant'],
  );
  assert.deepEqual(trace.usage(), { input: 250, output: 20, cache_read: 0, cache_write: 0 });
});

function reportCall(recorder: Telemetry, steps: Array<{ input: number; cacheRead: number }>) {
  steps.forEach(({ input, cacheRead }, stepNumber) =>
    recorder.onStepEnd?.({
      callId: 'turn',
      stepNumber,
      text: '',
      toolCalls: [],
      content: [],
      finishReason: 'stop',
      usage: {
        inputTokens: input + cacheRead,
        outputTokens: 0,
        inputTokenDetails: { noCacheTokens: input, cacheReadTokens: cacheRead, cacheWriteTokens: 0 },
        outputTokenDetails: {},
      },
      response: { modelId: 'gpt-6-luna' },
    } as never),
  );
  recorder.onEnd?.({
    callId: 'turn',
    totalUsage: {
      inputTokens: 6434,
      outputTokens: 27,
      inputTokenDetails: { noCacheTokens: 1826, cacheReadTokens: 4608, cacheWriteTokens: 0 },
      outputTokenDetails: {},
    },
  } as never);
}

test('a call’s reported total usage replaces step usage that does not add up to it', () => {
  for (const steps of [
    [
      { input: 0, cacheRead: 0 },
      { input: 0, cacheRead: 0 },
    ],
    [
      { input: 3100, cacheRead: 0 },
      { input: 900, cacheRead: 2300 },
    ],
  ]) {
    const trace = new Trace();
    reportCall(traceRecorder(trace), steps);
    assert.deepEqual(
      trace.steps.map((step) => step.usage.input + step.usage.cache_read),
      [0, 6434],
    );
    assert.deepEqual(trace.usage(), { input: 1826, output: 27, cache_read: 4608, cache_write: 0 });
  }
});

test('VACP executions become spans timed by their phases, and a failed one carries an error status', async () => {
  const at = (ms: number) => new Date(Date.UTC(2026, 8, 29, 12, 0, 0, ms)).toISOString();
  const spans = await traced(async () =>
    recordExecutions(
      tracing,
      [
        {
          id: 'x1',
          name: 'cohort.set_sex',
          operation: 'mutation',
          actor: 'agent',
          phase: 'succeeded',
          narration: 'Keeping female athletes.',
          phases: [
            { phase: 'accepted', at: at(0) },
            { phase: 'prepared', at: at(40) },
            { phase: 'running', at: at(45) },
            { phase: 'succeeded', at: at(120) },
          ],
        },
        {
          id: 'x2',
          name: 'vega_lite.set_selection',
          operation: 'mutation',
          actor: 'agent',
          phase: 'failed',
          message: 'x (monthdate_date) spans 2012-01-01 to 2012-12-31',
          phases: [
            { phase: 'accepted', at: at(200) },
            { phase: 'failed', at: at(210) },
          ],
        },
      ],
      false,
    ),
  );
  const done = spans.find((span) => span.name === 'vacp.execute cohort.set_sex')!;
  assert.equal(done.duration_ms, 120);
  assert.deepEqual(
    done.events.map((event) => event.name),
    ['accepted', 'prepared', 'running', 'succeeded'],
  );
  assert.equal(done.attributes['vacp.operation.kind'], 'mutation');
  assert.equal('vacp.execution.narration' in done.attributes, false);
  assert.equal(spans.find((span) => span.name === 'vacp.execute vega_lite.set_selection')!.status, 'error');
});
