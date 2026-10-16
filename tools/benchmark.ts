import { performance } from 'node:perf_hooks';

/**
 * Warm the same operation, then report a median across independent timing rounds. `before` runs
 * untimed ahead of each operation, for state the operation consumes, and then each operation is
 * timed alone.
 */
export async function measure(name: string, run: () => unknown, iterations = 100, before?: () => unknown) {
  const batch = async () => {
    if (!before) {
      const start = performance.now();
      for (let index = 0; index < iterations; index++) await run();
      return performance.now() - start;
    }
    let total = 0;
    for (let index = 0; index < iterations; index++) {
      await before();
      const start = performance.now();
      await run();
      total += performance.now() - start;
    }
    return total;
  };
  for (let index = 0; index < 20; index++) {
    await before?.();
    await run();
  }
  const rounds: number[] = [];
  for (let round = 0; round < 5; round++) rounds.push((await batch()) / iterations);
  rounds.sort((left, right) => left - right);
  const median = rounds[2]!;
  console.log(`${name}: ${median.toFixed(3)} ms/op (median of 5 x ${iterations})`);
  return median;
}
