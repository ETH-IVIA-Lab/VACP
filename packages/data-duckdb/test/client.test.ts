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
      useUnsafe(): never {
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
    async dropFile() {
      return null;
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
    async dropFile() {
      return null;
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
    async dropFile() {
      return null;
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

test('row loading releases its registered file after a failed typed import and preserves the import error', async () => {
  const files = new Set<string>();
  const dropped: string[] = [];
  const statements: string[] = [];
  const { connection } = connectionFixture();
  const client = await createDuckDbWasmClient({
    duckdb: {
      connect: async () => connection,
      registerFileText: async (path) => {
        files.add(path);
      },
      dropFile: async (path) => {
        files.delete(path);
        dropped.push(path);
        throw new Error('cleanup failed');
      },
    },
    connection: {
      ...connection,
      query: async (sql) => {
        statements.push(sql);
        throw new Error('staging cleanup failed');
      },
      insertJSONFromPath: async () => {
        throw new Error('import failed');
      },
    },
  });
  try {
    await assert.rejects(
      client.loadObjectsAsTable('readings', [{ value: '1.25' }], { types: { value: 'DOUBLE' } }),
      /import failed/,
    );
    assert.equal(files.size, 0);
    assert.equal(dropped.length, 1);
    assert.ok(statements.some((sql) => sql.startsWith('DROP TABLE IF EXISTS')));
  } finally {
    await client.dispose();
  }
});

test('row loading works when the host has no crypto.randomUUID', async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  t.after(() => Object.defineProperty(globalThis, 'crypto', descriptor));
  const { connection, calls } = connectionFixture();
  const files = new Set<string>();
  const client = await createDuckDbWasmClient({
    connection,
    duckdb: {
      connect: async () => connection,
      registerFileText: async (path) => {
        files.add(path);
      },
      dropFile: async (path) => {
        files.delete(path);
        return null;
      },
    },
  });
  t.after(() => client.dispose());
  await client.loadObjectsAsTable('readings', [{ value: 35 }]);
  assert.equal(calls.inserted, 1);
  assert.equal(files.size, 0);
});
