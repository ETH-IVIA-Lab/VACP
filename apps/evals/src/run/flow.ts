import { randomUUID } from 'node:crypto';

import { openGallery } from '../adapters/browser/host';
import type { Tracing } from '../adapters/telemetry';
import { promptOf, type Scenario } from '../core/scenario';
import type { ConditionSession } from '../ports';
import { approveFlow } from '../results/gate';
import { flowLabel, NO_MODEL, variantPaths, type Flow } from '../results/layout';
import type { InvocationRecord, ResultRow } from '../results/rows';
import { appendJsonl, readJsonl, writeJsonl } from '../results/store';
import type { Suite } from '../suite';
import { assertFreshBuilds, vacpRevision } from './environment';
import { runOne } from './run';

export type RunOptions = {
  suite: Suite;
  tracing: Tracing;
  condition: string;
  model?: string;
  variant: string;
  reps?: number;
  concurrency?: number;
  scenarios: readonly Scenario[];
  /** Use an already running gallery instead of serving one. */
  baseURL?: string;
  approveEval?: boolean;
  /** Record prompts, replies, and tool payloads in spans. Transcripts under `traces/` always hold them. */
  traceContent?: boolean;
  log(line: string): void;
  signal: AbortSignal;
};

/** The flow a condition id and model key name, with the resolved model when the condition calls one. */
function resolveFlow(suite: Suite, conditionId: string, modelKey?: string) {
  const condition = suite.conditions[conditionId];
  if (!condition)
    throw new Error(`Unknown condition "${conditionId}". Configured: ${Object.keys(suite.conditions).join(', ')}`);
  const model = condition.kind === 'agent' ? suite.model(modelKey ?? suite.defaultModel) : undefined;
  const flow: Flow = { condition: conditionId, model: model?.key ?? NO_MODEL };
  return { condition, model, flow };
}

/** Run one flow, a condition on a model, over the selected scenarios into one variant. */
export async function runFlow(options: RunOptions) {
  const { suite, log, signal } = options;
  const { condition, model, flow } = resolveFlow(suite, options.condition, options.model);
  const paths = variantPaths(suite.results, flow, options.variant);
  const split = suite.split();
  if (!split) throw new Error(`No split at ${suite.splitFile}. Run \`eval split\` first.`);
  const record = approveFlow({ suite, flow, model, split, approve: !!options.approveEval });
  const reps = options.reps ?? record.reps;

  // A row answered the scenario's wording at the time, so a reworded scenario runs again.
  const wording = new Map(options.scenarios.map((scenario) => [scenario.id, promptOf(scenario)]));
  const recorded = readJsonl<ResultRow>(paths.results);
  const current = recorded.filter((row) => (wording.get(row.scenario) ?? row.prompt) === row.prompt);
  if (current.length < recorded.length) {
    writeJsonl(paths.results, current);
    log(
      `${recorded.length - current.length} recorded runs answered an earlier wording of their scenario and run again`,
    );
  }
  const done = new Set(current.map((row) => `${row.scenario}#${row.rep}`));
  const jobs = options.scenarios.flatMap((scenario) =>
    Array.from({ length: reps }, (_, rep) => ({ scenario, rep })).filter(
      (job) => !done.has(`${job.scenario.id}#${job.rep}`),
    ),
  );
  log(
    `${flowLabel(flow)} / ${options.variant}: ${options.scenarios.length} scenarios × ${reps} reps, ` +
      `${jobs.length} to run (${options.scenarios.length * reps - jobs.length} already recorded)`,
  );
  if (!jobs.length) return { flow, paths };
  assertFreshBuilds(suite.repoRoot);

  // A gallery that stops answering fails every remaining run the same way, so the flow stops and a
  // rerun resumes the jobs it never started.
  const stopping = new AbortController();
  const flowSignal = AbortSignal.any([signal, stopping.signal]);
  const gallery = await openGallery({ ...suite.run, repoRoot: suite.repoRoot, baseURL: options.baseURL, signal });
  let session: ConditionSession | undefined;
  try {
    const start = { signal, workspace: suite.workspace(flow.condition) };
    session =
      condition.kind === 'agent' ? await condition.start({ ...start, model: model! }) : await condition.start(start);
    const invocation: InvocationRecord = {
      id: randomUUID(),
      started_at: new Date().toISOString(),
      condition: session.description,
      model: model ? { key: model.key, id: model.id, provider: model.provider.key } : null,
      vacp: vacpRevision(suite.repoRoot),
      node: process.version,
      base_url: gallery.url,
      run: { ...suite.run, reps, concurrency: options.concurrency ?? suite.run.concurrency },
      tracing: { content: options.traceContent ?? false, otlp: options.tracing.otlp },
    };
    appendJsonl(paths.invocations, invocation);
    const tally = { done: 0, passed: 0, errors: 0 };
    const began = Date.now();
    const queue = [...jobs];
    const worker = async () => {
      for (let job = queue.shift(); job && !flowSignal.aborted; job = queue.shift()) {
        const outcome = await runOne(job.scenario, job.rep, {
          flow,
          model,
          session: session!,
          gallery,
          tracing: options.tracing,
          paths,
          split,
          run: suite.run,
          invocation: invocation.id,
          traceContent: options.traceContent ?? false,
          signal: flowSignal,
        });
        if (!outcome.ok && outcome.unreachable && !stopping.signal.aborted) {
          log(`The gallery at ${gallery.url} stopped answering. Stopping this flow, and the same command resumes it.`);
          stopping.abort(new Error(`${gallery.url} is unreachable`));
        }
        tally.done++;
        if (outcome.ok && outcome.pass) tally.passed++;
        if (!outcome.ok) tally.errors++;
        const left = ((Date.now() - began) / tally.done) * (jobs.length - tally.done);
        log(
          `${tally.done}/${jobs.length} ${job.scenario.id}#${job.rep} ${outcome.ok ? (outcome.pass ? 'pass' : 'fail') : `error:${outcome.kind}`}` +
            ` · ${tally.passed} passed, ${tally.errors} errors · ~${Math.round(left / 1000)}s left`,
        );
      }
    };
    // An eval bug stops every worker, since each remaining run would fail the same way.
    const guarded = () =>
      worker().catch((error: unknown) => {
        stopping.abort(error);
        throw error;
      });
    await Promise.all(
      Array.from({ length: Math.min(options.concurrency ?? suite.run.concurrency, jobs.length) }, guarded),
    );
  } finally {
    await session?.close?.().catch(() => {});
    await gallery.close();
  }
  return { flow, paths };
}
