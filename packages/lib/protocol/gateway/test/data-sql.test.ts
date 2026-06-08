import assert from 'node:assert/strict';
import test from 'node:test';

import { VacpActionRegistry } from '../src/action-registry';
import { registerVacpDataSqlAction } from '../src/data-sql';

const PUBLIC_DATA_SQL_ACTION = 'vacp.data_sql';

async function withWindowUrl<T>(url: string | undefined, run: () => T | Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  if (url === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location: { href: url } },
    });
  }

  try {
    return await run();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    else delete (globalThis as { window?: unknown }).window;
  }
}

test('registerVacpDataSqlAction registers the SQL action by default', async () => {
  await withWindowUrl(undefined, async () => {
    const registry = new VacpActionRegistry();
    const descriptor = registerVacpDataSqlAction(registry, async () => ({ rows: [] }));

    assert.equal(descriptor?.name, PUBLIC_DATA_SQL_ACTION);
    assert.deepEqual(
      registry.list().map((action) => action.name),
      [PUBLIC_DATA_SQL_ACTION],
    );
  });
});

test('registerVacpDataSqlAction skips registration when enable-sql is 0', async () => {
  await withWindowUrl('http://localhost/?enable-sql=0', async () => {
    const registry = new VacpActionRegistry();
    const descriptor = registerVacpDataSqlAction(registry, async () => ({ rows: [] }));

    assert.equal(descriptor, null);
    assert.deepEqual(registry.list(), []);

    const result = await registry.execute({
      callId: 'call-1',
      name: PUBLIC_DATA_SQL_ACTION,
      params: { handleRef: 'vacp://example/data/main', sql: 'SELECT 1' },
    });
    assert.equal(result.ok, false);
    assert.match(result.error?.message ?? '', /Unknown action/);
  });
});

test('registerVacpDataSqlAction registers the SQL action when enable-sql is 1', async () => {
  await withWindowUrl('http://localhost/?enable-sql=1', async () => {
    const registry = new VacpActionRegistry();
    const descriptor = registerVacpDataSqlAction(registry, async () => ({ rows: [{ n: 1 }] }));

    assert.equal(descriptor?.name, PUBLIC_DATA_SQL_ACTION);
    assert.equal(registry.list().some((action) => action.name === PUBLIC_DATA_SQL_ACTION), true);
  });
});
