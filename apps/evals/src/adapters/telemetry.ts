import { OpenTelemetry } from '@ai-sdk/otel';
import { SpanStatusCode, type Tracer } from '@opentelemetry/api';
import { ExportResultCode, hrTimeToMilliseconds, type ExportResult } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  NodeTracerProvider,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-node';
import type { LanguageModelUsage, StepResult, Telemetry, ToolSet } from 'ai';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { ExecutionRecord } from '../core/scenario';
import type { Trace } from '../core/trace';
import type { Usage } from '../core/usage';
import type { RecordOptions } from '../ports';

const iso = (time: [number, number]) => new Date(hrTimeToMilliseconds(time)).toISOString();

/** Writes each finished span as one JSON line to its run's `spans.jsonl`, found by trace id. */
class SpanFiles implements SpanExporter {
  readonly files = new Map<string, string>();

  export(spans: ReadableSpan[], done: (result: ExportResult) => void) {
    for (const span of spans) {
      const { traceId, spanId } = span.spanContext();
      const file = this.files.get(traceId);
      if (!file) continue;
      const row = {
        trace_id: traceId,
        span_id: spanId,
        parent_span_id: span.parentSpanContext?.spanId ?? null,
        name: span.name,
        start: iso(span.startTime),
        end: iso(span.endTime),
        duration_ms: hrTimeToMilliseconds(span.duration),
        status: span.status.code === SpanStatusCode.ERROR ? 'error' : 'ok',
        status_message: span.status.message ?? null,
        attributes: span.attributes,
        events: span.events.map((event) => ({ name: event.name, at: iso(event.time), attributes: event.attributes })),
      };
      appendFileSync(file, `${JSON.stringify(row)}\n`);
    }
    done({ code: ExportResultCode.SUCCESS });
  }

  async shutdown() {}
}

export type Tracing = ReturnType<typeof createTracing>;

/**
 * The process's tracing. AI SDK calls report through `@ai-sdk/otel`'s `OpenTelemetry` integration, and
 * the runner's own spans parent theirs through the async context the provider registers. Spans also
 * stream to an OTLP collector when `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`
 * is set.
 */
export function createTracing() {
  const files = new SpanFiles();
  const otlp = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? null;
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ 'service.name': 'vacp-evals' }),
    spanProcessors: [
      new SimpleSpanProcessor(files),
      ...(otlp ? [new BatchSpanProcessor(new OTLPTraceExporter())] : []),
    ],
  });
  provider.register();
  const tracer: Tracer = provider.getTracer('vacp-evals');
  return {
    tracer,
    otel: new OpenTelemetry({ tracer }),
    /** The collector spans also stream to, or null. */
    otlp,
    /** Write a run's spans to `file`. */
    route(traceId: string, file: string) {
      mkdirSync(dirname(file), { recursive: true });
      files.files.set(traceId, file);
    },
    /** Flush spans still buffered for a collector. */
    shutdown: () => provider.shutdown(),
  };
}

/** AI SDK usage as billed parts. Input excludes cached tokens, which bill at their own rates. */
function billedUsage(usage: LanguageModelUsage): Usage {
  const cacheRead = usage.inputTokenDetails.cacheReadTokens ?? 0;
  const cacheWrite = usage.inputTokenDetails.cacheWriteTokens ?? 0;
  const input = usage.inputTokenDetails.noCacheTokens ?? Math.max(0, (usage.inputTokens ?? 0) - cacheRead - cacheWrite);
  return { input, output: usage.outputTokens ?? 0, cache_read: cacheRead, cache_write: cacheWrite };
}

function text(value: unknown): string {
  if (value instanceof Error) return value.message;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Fills a run's `Trace` from AI SDK telemetry, the lifecycle `generateText`, `ToolLoopAgent`, and
 * `HarnessAgent` all report: one step per model call with its duration, served model, and usage, then
 * each tool call with its result and execution time. A call's own total settles its steps' usage.
 */
export function traceRecorder(trace: Trace, options: RecordOptions = {}): Telemetry {
  const name = options.toolName ?? ((each: string) => each);
  const responseMs = new Map<string, number[]>();
  const executed = new Map<string, { ms: number; output: unknown; ok: boolean }>();
  const steps = new Map<string, number[]>();
  return {
    onLanguageModelCallEnd(event) {
      responseMs.set(event.callId, [...(responseMs.get(event.callId) ?? []), event.performance.responseTimeMs]);
    },
    onToolExecutionEnd(event) {
      const failed = event.toolOutput.type !== 'tool-result';
      executed.set(event.toolCall.toolCallId, {
        ms: event.toolExecutionMs,
        output: failed ? (event.toolOutput as { error: unknown }).error : event.toolOutput.output,
        ok: !failed,
      });
    },
    onStepEnd(step: StepResult<ToolSet>) {
      const index = trace.step({
        ms: responseMs.get(step.callId)?.shift() ?? Number.NaN,
        modelId: step.response.modelId,
        finishReason: step.finishReason,
        usage: billedUsage(step.usage),
      });
      steps.set(step.callId, [...(steps.get(step.callId) ?? []), index]);
      trace.assistant(step.text, step.reasoningText);
      for (const call of step.toolCalls) {
        const tool = name(call.toolName);
        trace.toolCall(tool, call.input);
        const run = executed.get(call.toolCallId);
        executed.delete(call.toolCallId);
        // A runtime that executes tools itself reports them only as the step's content parts.
        const part = run
          ? undefined
          : step.content.find(
              (each) =>
                (each.type === 'tool-result' || each.type === 'tool-error') && each.toolCallId === call.toolCallId,
            );
        const output = run
          ? run.output
          : part?.type === 'tool-error'
            ? (part as { error: unknown }).error
            : (part as { output?: unknown } | undefined)?.output;
        trace.toolResult(
          tool,
          output === undefined ? '' : text(output),
          run?.ms ?? 0,
          run ? run.ok : part?.type !== 'tool-error',
        );
      }
    },
    onEnd(event) {
      const indexes = steps.get(event.callId) ?? [];
      steps.delete(event.callId);
      responseMs.delete(event.callId);
      if ('totalUsage' in event) trace.settleCall(indexes, billedUsage(event.totalUsage));
    },
  };
}

/**
 * One `vacp.execute <action>` span per execution, under the active span, from its first phase to its
 * last, with each phase as an event. The step's narration is content, so it is recorded only with
 * `content`.
 */
export function recordExecutions(tracing: Tracing, executions: readonly ExecutionRecord[], content: boolean) {
  for (const execution of executions) {
    const first = execution.phases[0];
    const last = execution.phases.at(-1);
    if (!first || !last) continue;
    const span = tracing.tracer.startSpan(`vacp.execute ${execution.name}`, {
      startTime: new Date(first.at),
      attributes: {
        'vacp.execution.id': execution.id,
        'vacp.action.name': execution.name,
        'vacp.execution.phase': execution.phase,
        'vacp.actor.kind': execution.actor,
        ...(execution.operation ? { 'vacp.operation.kind': execution.operation } : {}),
        ...(execution.sourceId ? { 'vacp.source.id': execution.sourceId } : {}),
        ...(content && execution.narration ? { 'vacp.execution.narration': execution.narration } : {}),
      },
    });
    for (const phase of execution.phases) span.addEvent(phase.phase, new Date(phase.at));
    if (execution.phase !== 'succeeded')
      span.setStatus({ code: SpanStatusCode.ERROR, message: execution.message ?? execution.phase });
    span.end(new Date(last.at));
  }
}
