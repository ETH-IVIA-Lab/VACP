import type { CheckResult } from '../core/grade';
import type { RunMetrics } from '../core/metrics';
import type { ScenarioSource } from '../core/scenario';
import type { ModelPrice, Usage } from '../core/usage';
import type { ConditionDescription, Reply } from '../ports';
import type { Flow } from './layout';

/** One scored run of one scenario. */
export type ResultRow = RunMetrics & {
  scenario: string;
  rep: number;
  /** The run's trace in `spans.jsonl`. */
  trace_id: string;
  /** The invocation in `invocations.jsonl` that ran it. */
  invocation: string;
  prompt: string;
  /** `tags[0]`, the scenario's capability. */
  capability: string;
  tags: readonly string[];
  source: ScenarioSource;
  split: 'train' | 'test' | 'unsplit';
  status: 'ok' | 'truncated';
  /** How each turn ended. */
  stops: Reply['stop'][];
  grade: Record<string, number | null>;
  explanation: Record<string, string>;
  checks: CheckResult[];
  /** Relative to the variant directory. */
  screenshot: string;
};

/**
 * Why a run produced nothing to grade. It never scores, and a later run retries it. `interrupted`
 * means the process stopped the run, by a signal or because the gallery stopped answering.
 */
export type ErrorClass = 'setup' | 'agent' | 'provider' | 'timeout' | 'served-model-mismatch' | 'interrupted';

export type ErrorRow = {
  scenario: string;
  rep: number;
  trace_id: string;
  invocation: string;
  class: ErrorClass;
  message: string;
  at: string;
  served_model: string | null;
  usage: Usage;
};

/** The VACP code a run measured: the commit, and a digest of changes to the packages and examples. */
export type VacpRevision = { commit: string; vacp_diff: string };

export type InvocationRecord = {
  id: string;
  started_at: string;
  condition: ConditionDescription;
  model: { key: string; id: string; provider: string } | null;
  vacp: VacpRevision;
  node: string;
  base_url: string;
  run: Record<string, unknown>;
  tracing: { content: boolean; otlp: string | null };
};

/** `flow.json`: what every variant of a flow shares. */
export type FlowRecord = Flow & {
  /** The id the provider serves, or null for a condition without a model. */
  model_id: string | null;
  reps: number;
  split: { train: string[]; test: string[] };
  price?: ModelPrice;
  /** The eval's own code: runner, graders, scenarios, conditions. Variants compare only under one digest. */
  eval: { paths: string[]; sha: string };
};
