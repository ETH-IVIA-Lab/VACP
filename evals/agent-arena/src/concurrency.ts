export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number, workerID: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const queue = items.map((item, index) => ({ item, index }));
  const workerCount = Math.max(1, Math.min(limit, items.length));

  const workers = Array.from({ length: workerCount }, async (_, workerID) => {
    while (queue.length) {
      const next = queue.shift();

      if (!next) return;
      results[next.index] = await fn(next.item, next.index, workerID);
    }
  });

  await Promise.all(workers);

  return results;
}
