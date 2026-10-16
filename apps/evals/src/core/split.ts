import type { Scenario } from './scenario';

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export type Split = { seed: number; train: string[]; test: string[] };

/**
 * A random train/test split stratified by capability (`tags[0]`). Never by score: a train set picked
 * from failures regresses to the mean on re-run and tunes for the tail.
 */
export function drawSplit(scenarios: readonly Scenario[], seed: number, testShare = 1 / 3): Split {
  const next = random(seed);
  const strata = new Map<string, string[]>();
  for (const scenario of scenarios) {
    const stratum = strata.get(scenario.tags[0]) ?? [];
    stratum.push(scenario.id);
    strata.set(scenario.tags[0], stratum);
  }
  const train: string[] = [];
  const test: string[] = [];
  for (const [, ids] of [...strata].sort(([a], [b]) => a.localeCompare(b))) {
    const shuffled = [...ids]
      .sort()
      .map((id) => ({ id, key: next() }))
      .sort((a, b) => a.key - b.key);
    const held = Math.round(shuffled.length * testShare);
    shuffled.forEach(({ id }, index) => (index < held ? test : train).push(id));
  }
  return { seed, train: train.sort(), test: test.sort() };
}

/** Which side of the split a scenario is on. Scenarios added after the split are `unsplit`. */
export function splitOf(split: Split | undefined, id: string): 'train' | 'test' | 'unsplit' {
  return split?.test.includes(id) ? 'test' : split?.train.includes(id) ? 'train' : 'unsplit';
}
