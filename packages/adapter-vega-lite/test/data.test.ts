import assert from 'node:assert/strict';
import test from 'node:test';
import type { VacpDuckDbClient } from '@vacp/data-duckdb';
import { createVegaLiteProvider, type VegaViewLike } from '../src/index';

function database() {
  const tables = new Map<string, Record<string, unknown>[]>();
  let writes = 0;
  const drops = new Map<string, () => void>();
  const client: VacpDuckDbClient = {
    exec: async (sql) => {
      const table = /^DROP TABLE IF EXISTS main\.(\w+)$/.exec(sql)?.[1];
      assert.ok(table, `Unexpected statement ${sql}`);
      tables.delete(table);
      drops.get(table)?.();
      drops.delete(table);
    },
    queryArrowIpcBase64: async () => '',
    loadObjectsAsTable: async (table, rows) => {
      tables.set(table, structuredClone(rows));
      writes++;
    },
    queryJson: async (sql) => {
      const table = [...tables.keys()].find((name) => sql.includes(name));
      assert.ok(table, `Unknown table in ${sql}`);
      const rows = tables.get(table)!;
      if (sql.startsWith('PRAGMA')) {
        return {
          columns: ['name', 'type'],
          rows: [...new Set(rows.flatMap(Object.keys))].map((name) => ({ name, type: 'VARCHAR' })),
        };
      }
      if (sql.includes('COUNT(*)')) return { columns: ['n'], rows: [{ n: rows.length }] };
      return { columns: Object.keys(rows[0] ?? {}), rows: structuredClone(rows) };
    },
  };
  return {
    client,
    tables,
    writes: () => writes,
    nextDrop: (table: string) => new Promise<void>((resolve) => drops.set(table, resolve)),
  };
}

function viewWithData(datasets: Map<string, Record<string, unknown>[]>): VegaViewLike {
  return {
    signal: () => undefined,
    runAsync: async () => {},
    data: (name) => {
      const rows = datasets.get(name);
      if (!rows) throw new Error(`Unknown Vega dataset ${name}`);
      return rows;
    },
  };
}

const options = { appId: 'app', viewId: 'view', vizId: 'chart' };

test('layer sources with equal row counts keep distinct handles and data', async () => {
  const db = database();
  const left = [{ category: 'left', value: 1 }];
  const right = [{ category: 'right', value: 2 }];
  const provider = createVegaLiteProvider({
    view: viewWithData(
      new Map([
        ['source_0', left],
        ['source_1', right],
      ]),
    ),
    spec: {
      layer: [
        { data: { values: left }, mark: 'point' },
        { data: { values: right }, mark: 'point' },
      ],
    },
    options: { ...options, duckdbClient: db.client },
  });
  const observation = await provider.observe();
  const handles = observation.graph.nodes.filter((node) => node.kind === 'DataHandle');
  assert.equal(handles.length, 2);
  assert.equal(new Set(handles.map((node) => node.ref)).size, 2);
  assert.deepEqual([...db.tables.values()], [left, right]);
  provider.dispose?.();
});

test('live data revisions include later rows and columns and refresh schema metadata', async () => {
  const db = database();
  const initial = Array.from({ length: 8 }, (_, index) => ({ index, value: index }));
  const datasets = new Map<string, Record<string, unknown>[]>([['source_0', initial]]);
  const provider = createVegaLiteProvider({
    view: viewWithData(datasets),
    spec: { data: { values: initial }, mark: 'point' },
    options: { ...options, duckdbClient: db.client },
  });
  const initialObservation = await provider.observe();
  const handle = initialObservation.graph.nodes.find((node) => node.kind === 'DataHandle');
  assert.ok(handle);
  const schemaAction = initialObservation.graph.actions.find(
    (action) => action.operation.contract === 'vacp.data_schema',
  );
  assert.ok(schemaAction);
  const schema = () =>
    provider.execute({ callId: 'schema', name: schemaAction.name, params: { handleRef: handle.ref } });
  const before = await schema();
  assert.equal(before.ok, true);
  assert.equal(db.writes(), 1);

  const updated = initial.map((row) => ({ ...row }));
  datasets.set('source_0', updated);
  Object.assign(updated[7], { value: 900, lateColumn: 'visible' });
  const after = await schema();
  assert.equal(after.ok, true);
  assert.notDeepEqual(after.result, before.result);
  assert.equal(db.writes(), 2);
  assert.deepEqual([...db.tables.values()][0][7], { index: 7, value: 900, lateColumn: 'visible' });
  const current = await provider.observe();
  assert.match(JSON.stringify(current.graph.nodes.find((node) => node.ref === handle.ref)?.data), /lateColumn/);
  assert.equal(db.writes(), 2);
  provider.dispose?.();
});

test('replacing a source preserves shared-client data until its own binding is disposed', async () => {
  const db = database();
  const chart = (value: string) => {
    const rows = [{ value }];
    return createVegaLiteProvider({
      view: viewWithData(new Map([['source_0', rows]])),
      spec: { data: { values: rows }, mark: 'point' },
      options: { ...options, duckdbClient: db.client },
    });
  };
  const original = chart('original');
  const oldObservation = await original.observe();
  const replacement = chart('replacement');
  const current = await replacement.observe();
  const oldHandle = oldObservation.graph.nodes.find((node) => node.kind === 'DataHandle')!;
  const newHandle = current.graph.nodes.find((node) => node.kind === 'DataHandle')!;
  const oldTable = oldHandle.data?.tableName;
  const newTable = newHandle.data?.tableName;
  assert.equal(oldHandle.ref, newHandle.ref);
  assert.ok(typeof oldTable === 'string');
  assert.ok(typeof newTable === 'string');
  assert.notEqual(oldTable, newTable);
  const oldDropped = db.nextDrop(oldTable);
  original.dispose!();
  await oldDropped;
  assert.equal(db.tables.has(oldTable), false);
  assert.equal(db.tables.has(newTable), true);
  const sql = current.graph.actions.find((action) => action.operation.contract === 'vacp.data_sql')!;
  const result = await replacement.execute({
    callId: 'replacement-data',
    name: sql.name,
    params: { handleRef: newHandle.ref, sql: 'SELECT * FROM vacp_handle' },
  });
  assert.equal(result.ok, true);
  assert.ok(result.result && typeof result.result === 'object' && 'rows' in result.result);
  assert.deepEqual(result.result.rows, [{ value: 'replacement' }]);
  const replacementDropped = db.nextDrop(newTable);
  replacement.dispose!();
  await replacementDropped;
  assert.equal(db.tables.size, 0);
});
