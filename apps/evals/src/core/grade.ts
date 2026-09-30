import type { CheckKind, ExecutionRecord, Scenario } from './scenario';

export type CheckResult = {
  turn: number;
  kind: CheckKind;
  label: string;
  severity: 'gate' | 'soft';
  score: number;
  threshold?: number;
  passed: boolean;
  observed: string;
  message?: string;
};

/** A run's grading inputs: the state after setup, and per turn everything a check can read. */
export type GradingRecord = {
  initial: Record<string, unknown>;
  turns: Array<{
    reply: string;
    state: Record<string, unknown>;
    executions: ExecutionRecord[];
    /** The rendered text of every selector the turn's checks read. */
    texts: Record<string, string | null>;
  }>;
};

function observed(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text === undefined ? 'undefined' : text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

/**
 * Grade turn `index` of a run from its grading inputs. `text` reads a selector's rendered text: the
 * live page while the run is open, or the text the record stored when regrading.
 */
export async function gradeTurn(
  scenario: Scenario,
  record: GradingRecord,
  index: number,
  text: (selector: string) => Promise<string | null>,
): Promise<CheckResult[]> {
  const inputs = record.turns[index]!;
  const context = {
    ...inputs,
    before: index ? record.turns[index - 1]!.state : record.initial,
    initial: record.initial,
    text,
  };
  const results: CheckResult[] = [];
  for (const check of scenario.turns[index]!.expect) {
    const value = await check.read(context);
    const { assertion } = check;
    const evaluation = await assertion.evaluate(value);
    const bar = assertion.threshold ?? (assertion.severity === 'gate' ? 1 : undefined);
    results.push({
      turn: index,
      kind: check.kind,
      label: check.label,
      severity: assertion.severity,
      score: evaluation.score,
      threshold: assertion.threshold,
      passed: bar === undefined || evaluation.score >= bar,
      observed: observed(value),
      message: evaluation.message,
    });
  }
  return results;
}

/** Gate metrics: `pass` over every gate, then one per check kind. Null when a scenario has no such check. */
const metricKinds: Record<'state' | 'answer' | 'guard', readonly CheckKind[]> = {
  state: ['state', 'view'],
  answer: ['answer'],
  guard: ['guard'],
};

export function summarize(results: readonly CheckResult[]) {
  const gates = results.filter((result) => result.severity === 'gate');
  const grade: Record<string, number | null> = { pass: gates.every((result) => result.passed) ? 1 : 0 };
  const explanation: Record<string, string> = {};
  const describe = (failed: readonly CheckResult[]) =>
    failed
      .map(
        (result) =>
          `turn ${result.turn + 1} · ${result.label}: observed ${result.observed}${result.message ? ` (${result.message})` : ''}`,
      )
      .join('\n');
  for (const [metric, kinds] of Object.entries(metricKinds)) {
    const own = gates.filter((result) => kinds.includes(result.kind));
    grade[metric] = own.length ? (own.every((result) => result.passed) ? 1 : 0) : null;
    const failed = own.filter((result) => !result.passed);
    if (failed.length) explanation[metric] = describe(failed);
  }
  const failed = gates.filter((result) => !result.passed);
  if (failed.length) explanation.pass = describe(failed);
  for (const result of results.filter((each) => each.severity === 'soft')) grade[`soft:${result.label}`] = result.score;
  return { grade, explanation };
}
