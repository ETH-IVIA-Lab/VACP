import { isDeepStrictEqual } from 'node:util';

type Evaluation = { score: number; message?: string };

/**
 * Scores one value between 0 and 1. A gate passes at its threshold, 1 unless set, and decides a
 * run's `pass`. A soft assertion is tracked as its own metric and never decides `pass`.
 */
export type Assertion<Value = unknown> = {
  readonly name: string;
  readonly severity: 'gate' | 'soft';
  readonly threshold?: number;
  evaluate(value: Value): Evaluation | Promise<Evaluation>;
  /** The same assertion as a tracked metric, passing at `threshold` when one is given. */
  soft(threshold?: number): Assertion<Value>;
};

function describe(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : (JSON.stringify(value) ?? String(value));
}

function assertion<Value>(
  name: string,
  evaluate: (value: Value) => Evaluation | Promise<Evaluation>,
  severity: Assertion['severity'] = 'gate',
  threshold?: number,
): Assertion<Value> {
  return {
    name,
    severity,
    threshold,
    evaluate,
    soft: (bar) => assertion(name, evaluate, 'soft', bar),
  };
}

/** Holds when `predicate` returns true for the value. */
export function satisfies<Value>(predicate: (value: Value) => boolean, name = 'satisfies'): Assertion<Value> {
  return assertion(name, (value) =>
    predicate(value) ? { score: 1 } : { score: 0, message: `predicate did not hold for ${describe(value)}` },
  );
}

/** Holds when the value deeply and strictly equals `expected`. */
export function equals(expected: unknown): Assertion {
  return assertion('equals', (value) =>
    isDeepStrictEqual(value, expected)
      ? { score: 1 }
      : { score: 0, message: `expected ${describe(expected)}, received ${describe(value)}` },
  );
}
