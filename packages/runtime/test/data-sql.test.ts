import assert from 'node:assert/strict';
import test from 'node:test';
import { VacpActionRegistry, registerVacpDataSqlAction } from '../src/index';

test('SQL registration exposes a handler with validated parameters', async () => {
  const registry = new VacpActionRegistry();
  registerVacpDataSqlAction(registry, async (params) => ({ sql: params.sql }));

  const result = await registry.execute({
    callId: 'query',
    name: 'vacp.data_sql',
    params: { handleRef: 'vacp://app/data/main', sql: 'SELECT 1' },
  });

  assert.deepEqual(result, { callId: 'query', ok: true, result: { sql: 'SELECT 1' } });

  const invalid = await registry.execute({
    callId: 'invalid',
    name: 'vacp.data_sql',
    params: { handleRef: 'invalid', sql: 'SELECT 1' },
  });

  assert.equal(invalid.ok, false);
});

test('SQL registration respects explicit application policy', async () => {
  const registry = new VacpActionRegistry();
  assert.equal(
    registerVacpDataSqlAction(registry, async () => ({}), { enabled: false }),
    null,
  );
  assert.deepEqual(registry.list(), []);
  assert.equal((await registry.execute({ callId: 'query', name: 'vacp.data_sql' })).ok, false);
});
