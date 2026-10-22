import assert from 'node:assert/strict';
import test from 'node:test';
import { vacpAgentActor } from '@ethivia/vacp-protocol';
import { executeVacpAction, VacpActionRegistry, registerVacpDataSqlAction } from '../src/index';

const context = { actor: vacpAgentActor };

test('SQL registration exposes a handler with validated parameters', async () => {
  const registry = new VacpActionRegistry();
  registerVacpDataSqlAction(registry, async (params) => ({ sql: params.sql }));

  const result = await executeVacpAction(
    registry,
    {
      callId: 'query',
      name: 'vacp.data_sql',
      params: { handleRef: 'vacp://app/data/main', sql: 'SELECT 1' },
    },
    context,
  );

  assert.deepEqual(result, { callId: 'query', ok: true, result: { sql: 'SELECT 1' } });

  const invalid = await executeVacpAction(
    registry,
    {
      callId: 'invalid',
      name: 'vacp.data_sql',
      params: { handleRef: 'vacp://app/data/main', sql: 'SELECT 1', maxRows: 501 },
    },
    context,
  );

  assert.deepEqual(invalid, {
    callId: 'invalid',
    ok: false,
    error: {
      message: 'Invalid parameters for action "vacp.data_sql"',
      details: {
        code: 'invalid-params',
        issues: [{ path: ['maxRows'], code: 'too_big', message: 'Too big: expected number to be <=500' }],
      },
    },
  });
});
