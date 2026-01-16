export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = Array.from({ length: items.length }) as R[];
  const queue = items.map((item, index) => ({ item, index }));
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length) {
      const next = queue.shift();
      if (!next) return;
      results[next.index] = await fn(next.item, next.index);
    }
  });
  await Promise.all(workers);
  return results;
}
