/** Billed token counts. `input` excludes cache reads and writes, which bill at their own rates. */
export type Usage = { input: number; output: number; cache_read: number; cache_write: number };

/** USD per million tokens. Cache prices are explicit because providers bill them differently. */
export type ModelPrice = Usage;

export const noUsage: Usage = { input: 0, output: 0, cache_read: 0, cache_write: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cache_read: a.cache_read + b.cache_read,
    cache_write: a.cache_write + b.cache_write,
  };
}

export function sameUsage(a: Usage, b: Usage): boolean {
  return (
    a.input === b.input && a.output === b.output && a.cache_read === b.cache_read && a.cache_write === b.cache_write
  );
}

/** Dollars for one run's usage, or undefined when the model has no declared price. */
export function cost(usage: Usage, price: ModelPrice | undefined): number | undefined {
  if (!price) return undefined;
  return (
    (usage.input * price.input +
      usage.output * price.output +
      usage.cache_read * price.cache_read +
      usage.cache_write * price.cache_write) /
    1e6
  );
}
