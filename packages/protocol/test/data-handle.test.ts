import assert from 'node:assert/strict';
import test from 'node:test';
import { vacpDataHandle } from '../src/index';

const read = {
  ref: 'vacp://app/data/main' as const,
  table: 'trips',
  columns: [{ name: 'time', type: 'DOUBLE' }],
  rowCount: null,
  selectionWhere: '"time" > 8',
};

test('a host states the row count, metadata, and stats a handle reports beside what its provider read', async () => {
  const seen: unknown[] = [];
  const handle = await vacpDataHandle(read, (subject) => {
    seen.push(subject);
    return { rowCount: 12, metadata: { source: 'NYC taxi trips' }, stats: { loadedAt: '2026-09-30' } };
  });
  assert.deepEqual(seen, [{ ref: 'vacp://app/data/main', table: 'trips' }]);
  assert.deepEqual(handle, {
    data: { table: 'trips', columns: [{ name: 'time', type: 'DOUBLE' }], metadata: { source: 'NYC taxi trips' } },
    state: { kind: 'DataHandle', rowCount: 12, selectionWhere: '"time" > 8', stats: { loadedAt: '2026-09-30' } },
  });
});

test('a hook that states nothing or fails leaves the handle as its provider read it', async () => {
  const bare = {
    data: { table: 'trips', columns: [{ name: 'time', type: 'DOUBLE' }] },
    state: { kind: 'DataHandle', rowCount: null, selectionWhere: '"time" > 8' },
  };
  assert.deepEqual(await vacpDataHandle(read), bare);
  assert.deepEqual(await vacpDataHandle({ ...read, rowCount: 5 }, () => ({})), {
    ...bare,
    state: { ...bare.state, rowCount: 5 },
  });
  assert.deepEqual(
    await vacpDataHandle(read, () => {
      throw new Error('offline');
    }),
    bare,
  );
  assert.deepEqual(await vacpDataHandle(read, async () => Promise.reject(new Error('offline'))), bare);
});
