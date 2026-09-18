import assert from 'node:assert/strict';
import test from 'node:test';
import { mapLimit } from '../src/concurrency.ts';

test('mapLimit preserves result order and gives concurrent workers distinct bounded IDs', async () => {
  const items = ['first', 'second', 'third', 'queued'];
  const active = new Set<number>();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const release: Array<() => void> = [];
  const gates = Array.from(
    { length: 3 },
    () =>
      new Promise<void>((resolve) => {
        release.push(resolve);
      }),
  );
  const pending = mapLimit(items, 3, async (item, index, workerID) => {
    assert.equal(item, items[index]);
    assert.ok(workerID >= 0 && workerID < 3);
    assert.equal(active.has(workerID), false, 'each worker owns at most one in-flight task');
    active.add(workerID);
    if (active.size === 3) started();
    if (index < 3) await gates[index];
    active.delete(workerID);
    return item;
  });
  try {
    await ready;
    assert.deepEqual([...active].sort(), [0, 1, 2]);
    for (const finish of [...release].reverse()) finish();
    assert.deepEqual(await pending, items);
  } finally {
    for (const finish of release) finish();
    await pending;
  }
});
