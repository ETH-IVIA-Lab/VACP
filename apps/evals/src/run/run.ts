import { SpanStatusCode } from '@opentelemetry/api';
import type { VacpActor } from '@vacp/protocol';
import { APICallError, RetryError } from 'ai';
import { relative } from 'node:path';

import type { Gallery } from '../adapters/browser/host';
import type { EvalPage } from '../adapters/browser/page';
import { recordExecutions, traceRecorder, type Tracing } from '../adapters/telemetry';
import { gradeTurn, summarize, type CheckResult, type GradingRecord } from '../core/grade';
import { runMetrics } from '../core/metrics';
import { promptOf, type ExecutionRecord, type Scenario } from '../core/scenario';
import { splitOf, type Split } from '../core/split';
import { Trace } from '../core/trace';
import { servedAs } from '../core/usage';
import type { ConditionSession, Conversation, Reply, ResolvedModel, TelemetryFor } from '../ports';
import type { Flow, VariantPaths } from '../results/layout';
import type { ErrorClass, ErrorRow, ResultRow } from '../results/rows';
import { appendJsonl, writeJson } from '../results/store';
import type { RunDefaults } from '../suite';

/** Setup runs as a system actor, so presence shows nothing and guards never count it as the agent's. */
const setupActor: VacpActor = { id: 'eval-setup', kind: 'system', label: 'Eval setup' };

/** A run that failed for a reason of its own, recorded under its class. */
class RunError extends Error {
  constructor(
    readonly kind: ErrorClass,
    message: string,
  ) {
    super(message);
  }
}

/** The eval itself failed while grading or recording a run. The flow stops, since a rerun would fail the same way. */
export class EvalBugError extends Error {
  override name = 'EvalBugError';
}

export type RunContext = {
  flow: Flow;
  model: ResolvedModel | undefined;
  session: ConditionSession;
  gallery: Gallery;
  tracing: Tracing;
  paths: VariantPaths;
  split: Split;
  run: RunDefaults;
  invocation: string;
  /** Record prompts, replies, and tool payloads in spans. Transcripts under `traces/` always hold them. */
  traceContent: boolean;
  signal: AbortSignal;
};

export type RunOutcome = { ok: true; pass: boolean } | { ok: false; kind: ErrorClass; unreachable: boolean };

async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let cancel!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    cancel = () => reject(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

/** One run of one scenario: setup, the conversation turn by turn, grading, and the recorded row. */
export async function runOne(scenario: Scenario, rep: number, context: RunContext): Promise<RunOutcome> {
  const { flow, paths, tracing } = context;
  const split = splitOf(context.split, scenario.id);
  // One trace per run: the agent's AI SDK spans and VACP's execution spans nest under `eval.run`.
  return tracing.tracer.startActiveSpan(
    `eval.run ${scenario.id}`,
    {
      attributes: {
        'vacp.eval.condition': flow.condition,
        'vacp.eval.model': flow.model,
        'vacp.eval.variant': paths.variant,
        'vacp.eval.scenario': scenario.id,
        'vacp.eval.rep': rep,
        'vacp.eval.split': split,
        'vacp.eval.capability': scenario.tags[0],
      },
    },
    async (span) => {
      const traceId = span.spanContext().traceId;
      tracing.route(traceId, paths.spans);
      const ceiling = AbortSignal.timeout(context.run.timeoutS * 1000);
      const signal = AbortSignal.any([context.signal, ceiling]);
      const trace = new Trace();
      const record = (executions: readonly ExecutionRecord[]) =>
        recordExecutions(tracing, executions, context.traceContent);
      const telemetry: TelemetryFor = (options) => ({
        integrations: [tracing.otel, traceRecorder(trace, options)],
        functionId: flow.condition,
        recordInputs: context.traceContent,
        recordOutputs: context.traceContent,
      });
      let phase: 'setup' | 'conversation' | 'grading' | 'recording' = 'setup';
      let opened: { page: EvalPage; close(): Promise<void> } | undefined;
      let conversation: Conversation | undefined;
      try {
        opened = await context.gallery.open(scenario.page.path, signal);
        const { page } = opened;
        try {
          for (const step of scenario.setup) await page.act(step, setupActor);
        } catch (error) {
          throw new RunError('setup', (error as Error).message);
        }
        record(await page.executions());
        const initial = await page.state();
        const { description } = context.session;
        if (description.instructions) trace.system(description.instructions);
        phase = 'conversation';
        conversation = await context.session.conversation({
          page,
          scenario,
          trace,
          signal,
          maxSteps: context.run.maxSteps,
          telemetry,
        });
        const grading: GradingRecord = { initial, turns: [] };
        const checks: CheckResult[] = [];
        const stops: Reply['stop'][] = [];
        const turnMs: number[] = [];
        const agentExecutions: ExecutionRecord[] = [];
        for (const [index, turn] of scenario.turns.entries()) {
          phase = 'conversation';
          trace.beginTurn(turn.say);
          const reply = await tracing.tracer.startActiveSpan(
            'eval.turn',
            { attributes: { 'vacp.eval.turn': index + 1 } },
            async (turnSpan) => {
              const started = performance.now();
              try {
                return await abortable(conversation!.say(turn.say), signal);
              } finally {
                turnMs.push(performance.now() - started);
                turnSpan.end();
              }
            },
          );
          stops.push(reply.stop);
          const executions = await page.executions();
          record(executions);
          const agent = executions.filter((execution) => execution.actor === 'agent');
          agentExecutions.push(...agent);
          phase = 'grading';
          const inputs = {
            reply: reply.text,
            state: await page.state(),
            executions: agent,
            texts: {} as Record<string, string | null>,
          };
          grading.turns.push(inputs);
          checks.push(
            ...(await gradeTurn(
              scenario,
              grading,
              index,
              async (selector) => (inputs.texts[selector] = await page.text(selector)),
            )),
          );
        }
        phase = 'recording';
        const metrics = runMetrics({ trace, executions: agentExecutions, turnMs });
        const served = trace.steps.flatMap((step) => (step.modelId ? [step.modelId] : []));
        const mismatch = context.model && served.find((each) => !servedAs(context.model!.id, each));
        if (mismatch) throw new RunError('served-model-mismatch', `Requested ${context.model!.id}, served ${mismatch}`);
        const screenshot = paths.screenshot(scenario.id, rep);
        await page.page.screenshot({ path: screenshot }).catch(() => {});
        const { grade, explanation } = summarize(checks);
        const row: ResultRow = {
          scenario: scenario.id,
          rep,
          trace_id: traceId,
          invocation: context.invocation,
          prompt: promptOf(scenario),
          capability: scenario.tags[0],
          tags: scenario.tags,
          source: scenario.source,
          split,
          status: stops.includes('length') ? 'truncated' : 'ok',
          stops,
          grade,
          explanation,
          checks,
          ...metrics,
          screenshot: relative(paths.dir, screenshot),
        };
        writeJson(paths.trace(scenario.id, rep), trace.turns);
        writeJson(paths.grading(scenario.id, rep), grading);
        appendJsonl(paths.results, row);
        for (const [metric, value] of Object.entries(grade))
          if (value !== null) span.setAttribute(`vacp.eval.grade.${metric}`, value);
        return { ok: true as const, pass: grade.pass === 1 };
      } catch (error) {
        if (!(error instanceof RunError) && (phase === 'grading' || phase === 'recording'))
          throw new EvalBugError(`${scenario.id}#${rep} failed while ${phase}: ${(error as Error)?.message ?? error}`);
        const kind: ErrorClass =
          error instanceof RunError
            ? error.kind
            : ceiling.aborted
              ? 'timeout'
              : context.signal.aborted
                ? 'interrupted'
                : phase === 'setup'
                  ? 'setup'
                  : APICallError.isInstance(error) || RetryError.isInstance(error)
                    ? 'provider'
                    : 'agent';
        const message = (error as Error)?.message ?? String(error);
        appendJsonl(paths.errors, {
          scenario: scenario.id,
          rep,
          trace_id: traceId,
          invocation: context.invocation,
          class: kind,
          message,
          at: new Date().toISOString(),
          served_model: trace.steps.at(-1)?.modelId ?? null,
          usage: trace.usage(),
        } satisfies ErrorRow);
        if (trace.turns.length) writeJson(paths.trace(scenario.id, rep), trace.turns);
        span.setAttribute('vacp.eval.error', kind);
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        return { ok: false as const, kind, unreachable: /ERR_CONNECTION_REFUSED/.test(message) };
      } finally {
        await conversation?.close?.().catch(() => {});
        if (opened) record(await opened.page.executions().catch(() => []));
        await opened?.close();
        span.end();
      }
    },
  );
}
