import assert from 'node:assert/strict';
import { mapLimit } from '../src/concurrency.ts';

async function main() {
  const seen = new Set<number>();
  const items = Array.from({ length: 9 }, (_, i) => i);

  const out = await mapLimit(items, 3, async (item, index, workerID) => {
    assert.equal(index, item);
    seen.add(workerID);
    await sleep(10);
    return { item, workerID };
  });

  assert.equal(out.length, items.length);
  for (const row of out) {
    assert.ok(row.workerID >= 0);
    assert.ok(row.workerID < 3);
  }
  assert.equal(seen.size, 3);

  console.log('map-limit-worker-id: ok');
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

void main();
