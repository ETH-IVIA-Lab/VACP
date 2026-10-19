import type { VacpActor, VacpExecution, VacpOperationKind } from '@ethivia/vacp-protocol';

import type { Assertion } from './assertions';

/** An example page the agent works on, served from the gallery. */
export type PageDefinition = {
  id: string;
  /** Gallery path, including a hash when the page selects a view by hash, e.g. `/vega-lite/#airports`. */
  path: string;
  title: string;
  /**
   * Raw data files behind the page, repository-relative. Gold derivations reference them by key,
   * so a declared answer is checked against the data rather than against a model's output.
   */
  data?: Readonly<Record<string, string>>;
};

export function definePage<const Page extends PageDefinition>(page: Page): Page {
  return page;
}

/**
 * One VACP action, named by its local name or contract (`cohort.set_sex`, `vega_lite.set_selection`).
 * The runner resolves it against the live graph, so source-qualified names stay out of scenarios.
 */
export type Act = { action: string; params?: unknown; narration?: string };

export function act(action: string, params?: unknown, narration?: string): Act {
  return { action, params, narration };
}

/** One VACP execution as the page runtime reported it, phase by phase, once it settled. */
export type ExecutionRecord = {
  id: string;
  name: string;
  operation: VacpOperationKind | undefined;
  actor: VacpActor['kind'];
  /** The terminal phase. */
  phase: Extract<VacpExecution['phase'], 'succeeded' | 'failed' | 'cancelled'>;
  phases: Array<{ phase: VacpExecution['phase']; at: string }>;
  /** The call's parameters, for executions the runtime records. */
  params?: unknown;
  sourceId?: string;
  narration?: string;
  message?: string;
};

/** What a check can read once a turn has settled. */
export type CheckContext = {
  /** The agent's reply to this turn. */
  reply: string;
  /** VACP state after this turn, keyed by ref. */
  state: Readonly<Record<string, unknown>>;
  /** VACP state before this turn. */
  before: Readonly<Record<string, unknown>>;
  /** VACP state after setup, before the first turn. */
  initial: Readonly<Record<string, unknown>>;
  /** Rendered text of the first element matching `selector`, or `null`. */
  text(selector: string): Promise<string | null>;
  /** The agent's executions during this turn, in order. */
  executions: readonly ExecutionRecord[];
};

export type CheckKind = 'state' | 'answer' | 'view' | 'guard';

/** A graded property. Gates decide `pass`. Soft checks become tracked metrics. */
export type Check = {
  kind: CheckKind;
  /** Unique within its turn, and a soft check's label within its scenario, where it names the metric. */
  label: string;
  assertion: Assertion;
  read(context: CheckContext): unknown;
};

type Oracle = {
  /** A reference solution through VACP actions. It proves the scenario is solvable and the checks agree. */
  steps?: readonly Act[];
  answer: string;
};

export type Turn = {
  say: string;
  expect: readonly Check[];
  oracle: Oracle;
};

/**
 * A gold derivation. `sql` runs in DuckDB with `{key}` replaced by the page's data file, and its first
 * row must equal `row`. `eval audit --gold` verifies every declaration.
 */
type Gold = { sql: string; row: Readonly<Record<string, unknown>> };

export type ScenarioSource = 'bug-report' | 'hand-written' | 'synthesized';

export type Scenario = {
  id: string;
  page: PageDefinition;
  /** `tags[0]` is the capability, the primary grouping and split stratum. */
  tags: readonly [string, ...string[]];
  source: ScenarioSource;
  /** Why a careful analyst would call this task hard. Stated before the scenario is admitted. */
  why: string;
  /** Actions applied as a system actor before the first turn. */
  setup: readonly Act[];
  turns: readonly Turn[];
  gold: readonly Gold[];
};

export type ScenarioInput = Omit<Scenario, 'setup' | 'gold'> & { setup?: readonly Act[]; gold?: readonly Gold[] };

export function defineScenario(input: ScenarioInput): Scenario {
  if (!/^[a-z0-9]+(?:[-/][a-z0-9]+)*$/.test(input.id)) throw new Error(`Scenario id "${input.id}" must be kebab-case`);
  if (!input.turns.length) throw new Error(`Scenario ${input.id} needs a turn`);
  const soft = new Set<string>();
  input.turns.forEach((turn, index) => {
    if (!turn.say.trim()) throw new Error(`Scenario ${input.id} turn ${index + 1} has no message`);
    if (!turn.expect.length) throw new Error(`Scenario ${input.id} turn ${index + 1} checks nothing`);
    const labels = turn.expect.map((check) => check.label);
    const repeated = labels.find((label, at) => labels.indexOf(label) !== at);
    if (repeated) throw new Error(`Scenario ${input.id} turn ${index + 1} repeats the check "${repeated}"`);
    // A soft check's label names its metric, so it is unique across the scenario's turns.
    for (const check of turn.expect.filter((each) => each.assertion.severity === 'soft')) {
      if (soft.has(check.label)) throw new Error(`Scenario ${input.id} repeats the soft check "${check.label}"`);
      soft.add(check.label);
    }
  });
  if (!input.why.trim()) throw new Error(`Scenario ${input.id} must say why it is hard`);
  return { ...input, setup: input.setup ?? [], gold: input.gold ?? [] };
}

/**
 * What a scenario says to the agent, turn by turn. A row recorded with other words answered another
 * question, so the runner runs it again and regrade leaves it alone.
 */
export function promptOf(scenario: Scenario): string {
  return scenario.turns.map((turn) => turn.say).join('\n\n');
}
