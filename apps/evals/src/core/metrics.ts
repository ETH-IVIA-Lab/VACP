import type { ExecutionRecord } from './scenario';
import { median } from './stats';
import type { Trace } from './trace';
import type { Usage } from './usage';

/** The measurements a scored run's row carries, defined once for every condition. */
export type RunMetrics = {
  usage: Usage;
  /** Wall-clock time of the conversation's turns, without setup or grading. */
  latency_s: number;
  model_calls: number;
  tool_calls: number;
  /** Characters returned by graph and state reads. */
  read_chars: number;
  tool_errors: number;
  /** How often the tool list changed within the run, which rewrites the prompt cache. Null when the condition's tools are fixed. */
  catalog_changes: number | null;
  /** Median time of the agent's executions, from accepted to settled, as the page runtime timed them. */
  action_ms: number | null;
  /** The model id the provider reported for the run's last model call. */
  served_model: string | null;
};

export function runMetrics(input: {
  trace: Trace;
  /** The agent's executions over the whole run. */
  executions: readonly ExecutionRecord[];
  turnMs: readonly number[];
}): RunMetrics {
  const { trace } = input;
  const durations = input.executions.flatMap((execution) => {
    const first = execution.phases[0];
    const last = execution.phases.at(-1);
    return first && last ? [Date.parse(last.at) - Date.parse(first.at)] : [];
  });
  return {
    usage: trace.usage(),
    latency_s: Math.round(input.turnMs.reduce((sum, ms) => sum + ms, 0) / 10) / 100,
    model_calls: trace.steps.length,
    tool_calls: trace.tools.length,
    read_chars: trace.tools.filter((tool) => tool.read).reduce((sum, tool) => sum + tool.chars, 0),
    tool_errors: trace.tools.filter((tool) => !tool.ok).length,
    catalog_changes: trace.catalogs.length ? trace.catalogs.length - 1 : null,
    action_ms: durations.length ? Math.round(median(durations)) : null,
    served_model: trace.steps.at(-1)?.modelId ?? null,
  };
}
