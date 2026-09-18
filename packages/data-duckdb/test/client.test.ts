import assert from 'node:assert/strict';
import test from 'node:test';
import { createDuckDbWasmClient } from '../src/index';

function connectionFixture() {
  const calls = { closed: 0, queried: 0, inserted: 0 };
  return {
    calls,
    connection: {
      async close() {
        calls.closed += 1;
      },
      async query(): Promise<never> {
        calls.queried += 1;
        throw new Error('Query reached the connection');
      },
      async useUnsafe(): Promise<never> {
        throw new Error('IPC is not used by this fixture');
      },
      async insertJSONFromPath() {
        calls.inserted += 1;
      },
    },
  };
}

test('injected connections and databases remain host-owned after disposal', async () => {
  const { connection, calls } = connectionFixture();
  let connects = 0;
  let files = 0;
  let terminations = 0;
  const database = {
    async connect() {
      connects += 1;
      return connection;
    },
    async registerFileText() {
      files += 1;
    },
    async terminate() {
      terminations += 1;
    },
  };
  const client = await createDuckDbWasmClient({ duckdb: database, connection });
  await client.loadObjectsAsTable('data', [{ value: 1 }]);
  assert.equal(files, 1);
  assert.equal(calls.inserted, 1);
  const pending = client.queryJson('SELECT 1');
  const disposal = client.dispose();
  await assert.rejects(pending, /disposed/);
  await disposal;
  await client.dispose();
  assert.equal(connects, 0);
  assert.equal(calls.closed, 0);
  assert.equal(calls.queried, 0);
  assert.equal(terminations, 0);
  await assert.rejects(client.loadObjectsAsTable('data', []), /disposed/);
  assert.equal(files, 1);
});

test('disposal during initialization closes the owned connection without dispatching a query', async () => {
  const { connection, calls } = connectionFixture();
  const entered = Promise.withResolvers<void>();
  const connected = Promise.withResolvers<typeof connection>();
  let terminations = 0;
  const database = {
    connect() {
      entered.resolve();
      return connected.promise;
    },
    async registerFileText() {},
    async terminate() {
      terminations += 1;
    },
  };
  const client = await createDuckDbWasmClient({ duckdb: database });
  const query = client.queryJson('SELECT 1');
  await entered.promise;
  const disposal = client.dispose();
  connected.resolve(connection);
  await assert.rejects(query, /disposed/);
  await disposal;
  await client.dispose();
  assert.equal(calls.closed, 1);
  assert.equal(calls.queried, 0);
  assert.equal(terminations, 0);
});

test('failed connection initialization does not take ownership of an injected database', async () => {
  let connects = 0;
  let terminations = 0;
  const database = {
    async connect(): Promise<never> {
      connects += 1;
      throw new Error('Connection failed');
    },
    async registerFileText() {},
    async terminate() {
      terminations += 1;
    },
  };
  const client = await createDuckDbWasmClient({ duckdb: database });
  await assert.rejects(client.queryJson('SELECT 1'), /Connection failed/);
  await assert.rejects(client.queryJson('SELECT 2'), /Connection failed/);
  await client.dispose();
  assert.equal(connects, 1);
  assert.equal(terminations, 0);
});

test('an unused client disposes without initializing a database', async () => {
  const client = await createDuckDbWasmClient();
  await client.dispose();
  await assert.rejects(client.queryJson('SELECT 1'), /disposed/);
});
