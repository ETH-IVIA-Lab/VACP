import { performance } from 'node:perf_hooks';

/** Warm the same operation, then report a median across independent timing rounds. */
export async function measure(name: string, run: () => unknown | Promise<unknown>, iterations = 100) {
  for (let index = 0; index < 20; index++) await run();
  const rounds: number[] = [];
  for (let round = 0; round < 5; round++) {
    const start = performance.now();
    for (let index = 0; index < iterations; index++) await run();
    rounds.push((performance.now() - start) / iterations);
  }
  rounds.sort((left, right) => left - right);
  const median = rounds[2]!;
  console.log(`${name}: ${median.toFixed(3)} ms/op (median of 5 x ${iterations})`);
  return median;
}
