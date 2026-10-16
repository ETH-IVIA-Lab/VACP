import { isDeepStrictEqual } from 'node:util';

import { satisfies, type Assertion } from './assertions';
import type { Check, CheckContext } from './scenario';

/** Read a dotted path such as `body.height.0` from a state value. */
function pathValue(value: unknown, path: string): unknown {
  if (!path) return value;
  return path.split('.').reduce<unknown>((current, key) => {
    if (current === null || current === undefined) return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

/** The state value at `ref` (and `path`) after the turn satisfies `assertion`. */
export function state(ref: string, path: string, assertion: Assertion, label?: string): Check {
  return {
    kind: 'state',
    label: label ?? `${ref.split('/').pop()}${path ? `.${path}` : ''} ${assertion.name}`,
    assertion,
    read: (context) => pathValue(context.state[ref], path),
  };
}

/** The rendered text of `selector` satisfies `assertion`: evidence from the page, not from VACP. */
export function view(selector: string, assertion: Assertion, label?: string): Check {
  return {
    kind: 'view',
    label: label ?? `view ${selector} ${assertion.name}`,
    assertion,
    read: (context) => context.text(selector),
  };
}

/** Lowercase, with typographic dashes and apostrophes written plainly, as models often type them. */
function words(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/\s+/g, ' ');
}

/**
 * Numbers written in prose. Thousands separators go, typographic dashes and minus signs read as
 * hyphens, and a hyphen is a sign only where no digit precedes it.
 */
export function numbersIn(text: string): number[] {
  return [
    ...text
      .replace(/[‐-―−]/g, '-')
      .replace(/(\d),(?=\d{3}\b)/g, '$1')
      .matchAll(/(?<![\w.])-?\d+(?:\.\d+)?/g),
  ].map((match) => Number(match[0]));
}

type Mention = number | string | RegExp;

function mentioned(reply: string, expected: Mention, tolerance: number): boolean {
  if (typeof expected === 'number')
    return numbersIn(reply).some((found) => Math.abs(found - expected) <= tolerance + 1e-9);
  if (expected instanceof RegExp) return expected.test(words(reply));
  return words(reply).includes(words(expected));
}

/**
 * The reply mentions `expected`. An array means any of its spellings. Numbers match within
 * `tolerance`, so `26.3` accepts "26.3%" and "about 26.3". A pattern tests the lowercased reply.
 */
export function mentions(
  expected: Mention | readonly Mention[],
  options: { tolerance?: number; label?: string } = {},
): Check {
  const spellings = Array.isArray(expected) ? expected : [expected as Mention];
  const tolerance = options.tolerance ?? 0;
  const label = options.label ?? `mentions ${spellings.map(String).join(' | ')}`;
  return {
    kind: 'answer',
    label,
    assertion: satisfies<string>((reply) => spellings.some((each) => mentioned(reply, each, tolerance)), label),
    read: (context) => context.reply,
  };
}

function same(
  name: 'unchanged' | 'restored',
  ref: string,
  path: string,
  baseline: (context: CheckContext) => Readonly<Record<string, unknown>>,
): Check {
  return {
    kind: 'guard',
    label: `${name} ${ref.split('/').pop()}${path ? `.${path}` : ''}`,
    assertion: satisfies<{ before: unknown; after: unknown }>(
      ({ before, after }) => isDeepStrictEqual(before, after),
      name,
    ),
    read: (context: CheckContext) => ({
      before: pathValue(baseline(context)[ref], path),
      after: pathValue(context.state[ref], path),
    }),
  };
}

/** The state at `ref` ends the turn as it began, so the agent left what the request did not mention. */
export function unchanged(ref: string, path = ''): Check {
  return same('unchanged', ref, path, (context) => context.before);
}

/** The state at `ref` is back to what it was before the first turn, as an "undo" asks. */
export function restored(ref: string, path = ''): Check {
  return same('restored', ref, path, (context) => context.initial);
}

/** Operations that read without changing the page. Any other succeeded execution changed it. */
const reads = new Set(['query', 'evaluation']);

/** The agent changed nothing during the turn: every execution it completed was a read or a query. */
export function readOnly(): Check {
  return {
    kind: 'guard',
    label: 'read only',
    assertion: satisfies<readonly string[]>((changes) => changes.length === 0, 'no changes'),
    read: (context) =>
      context.executions
        .filter((execution) => execution.phase === 'succeeded' && !reads.has(execution.operation ?? ''))
        .map((execution) => execution.name),
  };
}

// Assertions for state values.

export function within(min: number, max: number): Assertion {
  return satisfies<unknown>(
    (value) => typeof value === 'number' && value >= min && value <= max,
    `in [${min}, ${max}]`,
  );
}

/** An interval `[lo, hi]` whose ends lie within `tolerance` of `expected`. */
export function range(expected: readonly [number, number], tolerance = 0): Assertion {
  return satisfies<unknown>(
    (value) => {
      if (!Array.isArray(value) || value.length !== 2) return false;
      const [lo, hi] = [Math.min(value[0], value[1]), Math.max(value[0], value[1])];
      return Math.abs(lo - expected[0]) <= tolerance + 1e-9 && Math.abs(hi - expected[1]) <= tolerance + 1e-9;
    },
    `range ${JSON.stringify(expected)} ± ${tolerance}`,
  );
}

/** The same members in any order, compared case-insensitively for strings. */
export function sameMembers(expected: readonly unknown[]): Assertion {
  const key = (value: unknown) => (typeof value === 'string' ? value.toLowerCase() : JSON.stringify(value));
  const want = expected.map(key).sort();
  return satisfies<unknown>(
    (value) => Array.isArray(value) && JSON.stringify(value.map(key).sort()) === JSON.stringify(want),
    `members ${JSON.stringify(expected)}`,
  );
}

export function empty(): Assertion {
  return satisfies<unknown>(
    (value) =>
      value === null ||
      value === undefined ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === 'object' && Object.keys(value as object).length === 0),
    'empty',
  );
}

/** Text that contains every fragment, case-insensitively. */
export function containsAll(...fragments: string[]): Assertion {
  return satisfies<unknown>(
    (value) => typeof value === 'string' && fragments.every((fragment) => words(value).includes(words(fragment))),
    `contains ${fragments.join(', ')}`,
  );
}
