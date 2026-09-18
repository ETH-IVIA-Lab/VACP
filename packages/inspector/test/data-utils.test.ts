import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDataQueryTemplates,
  resultRowsToCsv,
  resultRowsToJson,
  safeDataExportName,
} from '../src/overlay/modules/data/data-utils';
import type { InspectorSqlSchema } from '../src/overlay/modules/data/use-sql-namespace';

const schema: InspectorSqlSchema = {
  vacp_handle: [],
  vacp_all: [
    { name: 'species', type: 'VARCHAR' },
    { name: 'body mass', type: 'DOUBLE' },
    { name: 'observed_at', type: 'TIMESTAMP' },
  ],
  rowCount: 3,
  source: 'data_schema',
};

test('data query templates use provider schema for common analysis queries', () => {
  const templates = buildDataQueryTemplates(schema);
  const byId = new Map(templates.map((template) => [template.id, template]));

  assert.match(byId.get('count')?.sql ?? '', /COUNT\(\*\)::INTEGER AS n_selected/);
  assert.match(byId.get('sample')?.sql ?? '', /SELECT \*\nFROM vacp_handle\nLIMIT 25;/);
  assert.match(byId.get('group-categorical')?.sql ?? '', /"species" AS category/);
  assert.match(byId.get('numeric-summary')?.sql ?? '', /AVG\("body mass"\) AS avg_value/);
  assert.match(byId.get('temporal-range')?.sql ?? '', /MIN\("observed_at"\) AS min_time/);
});

test('data query templates disable type-specific queries when schema lacks columns', () => {
  const templates = buildDataQueryTemplates({ vacp_handle: [], vacp_all: [], rowCount: null, source: 'none' });
  const byId = new Map(templates.map((template) => [template.id, template]));

  assert.equal(byId.get('count')?.disabledReason, undefined);
  assert.equal(byId.get('group-categorical')?.sql, null);
  assert.equal(byId.get('numeric-summary')?.disabledReason, 'No numeric column found in schema.');
  assert.equal(byId.get('temporal-range')?.disabledReason, 'No date or time column found in schema.');
});

test('data result export serializes CSV and JSON in table column order', () => {
  const columns = [
    { name: 'label', sqlType: 'string' as const, databaseType: 'VARCHAR', nullable: false },
    { name: 'n', sqlType: 'integer' as const, databaseType: 'INTEGER', nullable: false },
  ];

  const rows = [
    { label: 'plain', n: 1 },
    { label: 'quoted, "value"', n: 2 },
    { label: 'big', n: 9007199254740993n },
    { label: '=cmd', n: 3 },
  ];

  assert.equal(
    resultRowsToCsv(columns, rows),
    'label,n\nplain,1\n"quoted, ""value""",2\nbig,9007199254740993\n\'=cmd,3',
  );

  const json = JSON.parse(
    resultRowsToJson({
      columns,
      rows,
      resolvedSql: 'SELECT * FROM vacp_handle',
      selectedHandle: 'vacp://example/data/main',
    }),
  );

  assert.deepEqual(json.columns, [
    { name: 'label', type: 'VARCHAR' },
    { name: 'n', type: 'INTEGER' },
  ]);
  assert.deepEqual(json.rows, [
    { label: 'plain', n: 1 },
    { label: 'quoted, "value"', n: 2 },
    { label: 'big', n: '9007199254740993' },
    { label: '=cmd', n: 3 },
  ]);
});

test('data export filenames stay filesystem safe', () => {
  assert.equal(safeDataExportName('Main Data / Selected Rows', 'json'), 'main-data-selected-rows.json');
  assert.equal(safeDataExportName('   ', 'csv'), 'vacp-data.csv');
});
