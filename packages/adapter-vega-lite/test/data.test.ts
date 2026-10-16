import assert from 'node:assert/strict';
import test from 'node:test';
import type { VacpDataHandleData, VacpDataHandleState, VacpDataSchemaResult, VacpProvider } from '@vacp/protocol';
import { executeVacpAction } from '@vacp/runtime';
import { View, changeset, loader, parse } from 'vega';
import { compile, type TopLevelSpec } from 'vega-lite';
import { createVegaLiteProvider } from '../src/index';
import { nodeDuckDb } from './duckdb';

const options = { appId: 'app', viewId: 'view', vizId: 'chart' };

/** A headless Vega view of `spec`, with url sources served from `files`. */
async function render(spec: TopLevelSpec, files: Record<string, unknown[]> = {}) {
  const load = loader();
  load.load = async (url: string) => JSON.stringify(files[url] ?? []);
  const view = new View(parse(compile(spec).spec), { renderer: 'none', loader: load });
  await view.runAsync();
  return view;
}

/** Run SQL against one of a provider's data handles, the first by default, and return its rows. */
async function sql(provider: VacpProvider, text: string, handleIndex = 0) {
  const { graph } = await provider.observe();
  const handle = graph.nodes.filter((node) => node.kind === 'DataHandle')[handleIndex]!;
  const action = graph.actions.find((each) => each.operation.contract === 'vacp.data_sql')!;
  const result = await executeVacpAction(provider, {
    callId: text,
    name: action.name,
    params: { handleRef: handle.ref, sql: text },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.ok, JSON.stringify(result));
  return (result.result as { rows: Record<string, unknown>[] }).rows;
}

/** Render `spec` over a DuckDB engine in this process, run `check`, and release both. */
async function withChart(
  spec: TopLevelSpec,
  files: Record<string, unknown[]>,
  check: (provider: VacpProvider, db: Awaited<ReturnType<typeof nodeDuckDb>>, view: View) => Promise<void>,
  providerOptions: Partial<NonNullable<Parameters<typeof createVegaLiteProvider>[0]['data']>> = {},
) {
  const db = await nodeDuckDb();
  const view = await render(spec, files);
  const provider = createVegaLiteProvider({
    view,
    spec,
    vgSpec: compile(spec).spec,
    data: { duckdb: db.client, ...providerOptions },
    options: { ...options },
  });
  try {
    await check(provider, db, view);
  } finally {
    provider.dispose?.();
    view.finalize();
    db.close();
  }
}

async function schema(provider: VacpProvider) {
  const { graph } = await provider.observe();
  const handle = graph.nodes.find((node) => node.kind === 'DataHandle')!;
  const action = graph.actions.find((each) => each.operation.contract === 'vacp.data_schema')!;
  const result = await executeVacpAction(provider, {
    callId: 'schema',
    name: action.name,
    params: { handleRef: handle.ref },
  });
  assert.equal(result.ok, true);
  return result.result as VacpDataSchemaResult;
}

test('layer sources keep distinct handles, each answering over its own rows', async () => {
  const spec: TopLevelSpec = {
    layer: [
      { data: { values: [{ category: 'left', value: 1 }] }, mark: 'point' },
      { data: { values: [{ category: 'right', value: 2 }] }, mark: 'point' },
    ],
  };
  await withChart(spec, {}, async (provider) => {
    const { graph } = await provider.observe();
    const handles = graph.nodes.filter((node) => node.kind === 'DataHandle');
    assert.equal(new Set(handles.map((node) => node.ref)).size, 2);
    const action = graph.actions.find((each) => each.operation.contract === 'vacp.data_sql')!;
    const categories = await Promise.all(
      handles.map(async (handle) => {
        const result = await executeVacpAction(provider, {
          callId: handle.ref,
          name: action.name,
          params: { handleRef: handle.ref, sql: 'SELECT category FROM vacp_handle' },
        });
        assert.ok(result.ok, JSON.stringify(result));
        return (result.result as { rows: Array<{ category: string }> }).rows.map((row) => row.category);
      }),
    );
    assert.deepEqual(categories.flat().sort(), ['left', 'right']);
  });
});

test('a dataset change reloads its rows once, and the schema reads the new columns', async () => {
  const initial = Array.from({ length: 8 }, (_, index) => ({ index, value: index }));
  const spec: TopLevelSpec = { data: { name: 'table', values: initial }, mark: 'point' };
  await withChart(spec, {}, async (provider, db, view) => {
    assert.deepEqual(
      (await schema(provider)).vacp_handle.columns.map((column) => column.name),
      ['index', 'value'],
    );
    const loads = db.loads();
    view.data('table', [...initial.slice(0, 7), { index: 7, value: 900, lateColumn: 'visible' }]);
    await view.runAsync();
    assert.ok((await schema(provider)).vacp_handle.columns.some((column) => column.name === 'lateColumn'));
    assert.equal(db.loads(), loads + 1);
    const { graph } = await provider.observe();
    const handle = graph.nodes.find((node) => node.kind === 'DataHandle')!;
    assert.deepEqual(
      (handle.data as VacpDataHandleData).columns?.map((column) => column.name),
      ['index', 'value', 'lateColumn'],
      'the graph reads the new columns',
    );
    await schema(provider);
    assert.equal(db.loads(), loads + 1, 'an unchanged dataset keeps its table');
  });
});

test('replacing a chart keeps the shared client’s tables until the old binding is disposed', async () => {
  const db = await nodeDuckDb();
  const chart = async (value: string) => {
    const spec: TopLevelSpec = { data: { values: [{ value }] }, mark: 'point' };
    const view = await render(spec);
    return {
      view,
      provider: createVegaLiteProvider({
        view,
        spec,
        vgSpec: compile(spec).spec,
        data: { duckdb: db.client },
        options: { ...options },
      }),
    };
  };
  const original = await chart('original');
  const replacement = await chart('replacement');
  try {
    assert.deepEqual(await sql(original.provider, 'SELECT value FROM vacp_handle'), [{ value: 'original' }]);
    assert.deepEqual(await sql(replacement.provider, 'SELECT value FROM vacp_handle'), [{ value: 'replacement' }]);
    const dropped = db.nextDrop();
    original.provider.dispose?.();
    await dropped;
    assert.equal(db.tables.size, 1);
    assert.deepEqual(await sql(replacement.provider, 'SELECT value FROM vacp_handle'), [{ value: 'replacement' }]);
  } finally {
    replacement.provider.dispose?.();
    original.view.finalize();
    replacement.view.finalize();
    db.close();
  }
});

const gapminder = [1955, 1990, 2005].flatMap((year) => [
  { year, country: 'Chile', cluster: 3, life_expect: 50 + (year - 1955) / 2 },
  { year, country: 'Japan', cluster: 4, life_expect: 60 + (year - 1955) / 3 },
]);

test('vacp_all holds every row a url source loaded, and vacp_handle the rows the chart keeps', async () => {
  const spec: TopLevelSpec = {
    data: { url: 'data/gapminder.json' },
    params: [{ name: 'current_year', value: 1990, bind: { input: 'range', min: 1955, max: 2005, step: 5 } }],
    transform: [
      { filter: 'datum.year == current_year' },
      { calculate: "datum.cluster == 3 ? 'America' : 'East Asia'", as: 'region' },
    ],
    mark: 'point',
    encoding: { x: { field: 'country', type: 'nominal' }, y: { field: 'life_expect', type: 'quantitative' } },
  };
  await withChart(spec, { 'data/gapminder.json': gapminder }, async (provider, db, view) => {
    assert.deepEqual(
      await sql(provider, 'SELECT year::INT AS year, country, region FROM vacp_handle ORDER BY country'),
      [
        { year: 1990, country: 'Chile', region: 'America' },
        { year: 1990, country: 'Japan', region: 'East Asia' },
      ],
    );
    assert.deepEqual(
      await sql(provider, 'SELECT count(*)::INT AS rows, count(DISTINCT year)::INT AS years FROM vacp_all'),
      [{ rows: 6, years: 3 }],
    );
    assert.ok((await schema(provider)).vacp_all, 'the schema describes both relations');
    view.signal('current_year', 2005);
    await view.runAsync();
    const loads = db.loads();
    assert.deepEqual(await sql(provider, 'SELECT DISTINCT year::INT AS year FROM vacp_handle'), [{ year: 2005 }]);
    assert.equal(db.loads(), loads + 1, 'only the shown rows reload when the filter moves');
  });
});

test('an inline source’s filters and calculations reach vacp_handle, and its dates load as timestamps', async () => {
  const spec: TopLevelSpec = {
    data: {
      values: [
        { a: 1, d: '2012-06-01' },
        { a: -1, d: '2012-07-01' },
        { a: 2, d: '2012-08-01' },
      ],
    },
    transform: [{ filter: 'datum.a > 0' }, { calculate: 'datum.a * 2', as: 'b' }],
    mark: 'point',
    encoding: { x: { field: 'd', type: 'temporal' }, y: { field: 'b', type: 'quantitative' } },
  };
  await withChart(spec, {}, async (provider, db) => {
    assert.deepEqual(await sql(provider, 'SELECT a::INT AS a, b::INT AS b FROM vacp_handle ORDER BY a'), [
      { a: 1, b: 2 },
      { a: 2, b: 4 },
    ]);
    assert.deepEqual(await sql(provider, 'SELECT count(*)::INT AS n FROM vacp_all'), [{ n: 3 }]);
    // Vega reads a date alone as UTC midnight, and SQL returns it on the axis's local clock.
    const expected = new Date(Date.UTC(2012, 5, 1));
    const [first] = await sql(
      provider,
      "SELECT strftime(d, '%Y-%m-%d %H:%M') AS d FROM vacp_handle ORDER BY d LIMIT 1",
    );
    const pad = (value: number) => String(value).padStart(2, '0');
    assert.equal(
      first!.d,
      `${expected.getFullYear()}-${pad(expected.getMonth() + 1)}-${pad(expected.getDate())} ${pad(expected.getHours())}:${pad(expected.getMinutes())}`,
    );
    for (const table of db.tables) assert.equal((await db.types(table)).d, 'TIMESTAMP', table);
  });
});

// Local noon keeps each day on its calendar day in every time zone.
const days = ['2013-06-01T12:00', '2013-07-15T12:00', '2013-09-24T12:00', '2014-06-10T12:00'];

async function weather(tooltip = false) {
  const db = await nodeDuckDb();
  const spec: TopLevelSpec = {
    data: { url: 'data/weather.json' },
    params: [{ name: 'season', select: { type: 'interval', encodings: ['x'] } }],
    mark: { type: 'point', tooltip },
    encoding: { x: { timeUnit: 'monthdate', field: 'date', type: 'temporal' } },
  };
  const view = await render(spec, { 'data/weather.json': days.map((date) => ({ date })) });
  const provider = createVegaLiteProvider({
    view,
    spec,
    vgSpec: compile(spec).spec,
    data: { duckdb: db.client },
    options: { ...options },
  });
  const act = async (contract: string, params: unknown) => {
    const { graph } = await provider.observe();
    const action = graph.actions.find((each) => each.operation.contract === contract)!;
    return await (await provider.prepare({ callId: contract, name: action.name, params })).execute();
  };
  return {
    view,
    provider,
    act,
    dispose: () => {
      provider.dispose?.();
      view.finalize();
      db.close();
    },
  };
}

test('a brush on a month-and-day axis selects the same rows in SQL as in the chart', async () => {
  const f = await weather();
  try {
    const brushed = await f.act('vega_lite.set_selection', {
      ref: 'vacp://app/view/chart/param/season',
      value: { x: ['2012-06-01', '2012-08-31'] },
    });
    assert.equal(brushed.ok, true);
    const rows = await sql(f.provider, "SELECT strftime(date, '%Y-%m-%d') AS day FROM vacp_handle ORDER BY date");
    assert.deepEqual(
      rows.map((row) => row.day),
      ['2013-06-01', '2013-07-15', '2014-06-10'],
    );
    const [june] = await sql(
      f.provider,
      "SELECT strftime(monthdate_date, '%Y-%m-%d %H:%M') AS day FROM vacp_handle ORDER BY date LIMIT 1",
    );
    assert.equal(june!.day, '2012-06-01 00:00', 'the time unit reads on the axis clock');
  } finally {
    f.dispose();
  }
});

test('a hover on a date narrows vacp_handle to its rows, and a date the calendar lacks is rejected', async () => {
  const f = await weather(true);
  try {
    const hovered = await f.act('vega_lite.hover_tooltip', { fields: { date: '2013-07-15T12:00' } });
    assert.equal(hovered.ok, true);
    assert.equal((hovered.result as { matches: number }).matches, 1);
    assert.deepEqual(await sql(f.provider, "SELECT strftime(date, '%Y-%m-%d') AS day FROM vacp_handle"), [
      { day: '2013-07-15' },
    ]);
    await assert.rejects(
      f.act('vega_lite.hover_tooltip', { fields: { date: '2013-02-30' } }),
      /not a date on the calendar/,
    );
  } finally {
    f.dispose();
  }
});

test('fields a continuous scale reads load as numbers, and cells that name no number or date as null', async () => {
  // A CSV source parses only its dates, so the loaded rows carry every other value as text.
  const rows = [
    { date: '2012-06-01', temp_max: '12.8', weather: 'sun' },
    { date: '2012-06-02', temp_max: '15.6', weather: 'rain' },
    { date: 'unknown', temp_max: 'n/a', weather: 'fog' },
  ];
  const spec: TopLevelSpec = {
    data: { url: 'data/weather.json', format: { type: 'json', parse: { date: 'date' } } },
    mark: 'point',
    encoding: { x: { field: 'date', type: 'temporal' }, y: { field: 'temp_max', type: 'quantitative' } },
  };
  await withChart(spec, { 'data/weather.json': rows }, async (provider, db) => {
    assert.deepEqual(
      await sql(provider, 'SELECT round(avg(temp_max), 1) AS mean, count(date)::INT AS dated FROM vacp_all'),
      [{ mean: 14.2, dated: 2 }],
    );
    for (const table of db.tables) assert.equal((await db.types(table)).temp_max, 'DOUBLE', table);
  });
});

test('a filter that leaves the marks no rows leaves vacp_handle empty, with its columns', async () => {
  const spec: TopLevelSpec = {
    data: { values: gapminder },
    params: [{ name: 'minimum', value: 0 }],
    transform: [{ filter: 'datum.life_expect >= minimum' }],
    mark: 'point',
    encoding: { x: { field: 'country', type: 'nominal' }, y: { field: 'life_expect', type: 'quantitative' } },
  };
  await withChart(spec, {}, async (provider, db, view) => {
    assert.deepEqual(await sql(provider, 'SELECT count(*)::INT AS n FROM vacp_handle'), [{ n: 6 }]);
    view.signal('minimum', 1_000);
    await view.runAsync();
    assert.deepEqual(await sql(provider, 'SELECT count(*)::INT AS n, count(country)::INT AS named FROM vacp_handle'), [
      { n: 0, named: 0 },
    ]);
    assert.deepEqual(await sql(provider, 'SELECT count(*)::INT AS n FROM vacp_all'), [{ n: 6 }]);
  });
});

test('a chart that starts filtered to no rows reads an empty vacp_handle and every loaded row in vacp_all', async () => {
  const spec: TopLevelSpec = {
    data: { values: gapminder },
    params: [{ name: 'minimum', value: 1_000 }],
    transform: [{ filter: 'datum.life_expect >= minimum' }],
    mark: 'point',
    encoding: { x: { field: 'country', type: 'nominal' }, y: { field: 'life_expect', type: 'quantitative' } },
  };
  await withChart(spec, {}, async (provider) => {
    assert.deepEqual(await sql(provider, 'SELECT count(*)::INT AS n, count(country)::INT AS named FROM vacp_handle'), [
      { n: 0, named: 0 },
    ]);
    assert.deepEqual(await sql(provider, 'SELECT count(*)::INT AS n FROM vacp_all'), [{ n: 6 }]);
  });
});

test('each source types its own fields, so a field one layer plots as numbers stays text in another', async () => {
  const spec: TopLevelSpec = {
    layer: [
      {
        data: { values: [{ v: '3.5' }, { v: '4' }] },
        mark: 'point',
        encoding: { y: { field: 'v', type: 'quantitative' } },
      },
      {
        data: { values: [{ v: 'high' }, { v: 'low' }] },
        mark: 'text',
        encoding: { text: { field: 'v', type: 'nominal' } },
      },
    ],
  };
  await withChart(spec, {}, async (provider) => {
    const answers = [
      await sql(provider, 'SELECT v FROM vacp_handle ORDER BY v', 0),
      await sql(provider, 'SELECT v FROM vacp_handle ORDER BY v', 1),
    ];
    assert.deepEqual(
      answers.map((rows) => rows.map((row) => row.v)).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      [
        [3.5, 4],
        ['high', 'low'],
      ],
    );
  });
});

test('a field on a scale with an explicit domain loads as numbers', async () => {
  const rows = [{ temp_max: '12.5' }, { temp_max: '15.5' }];
  const spec: TopLevelSpec = {
    data: { url: 'data/weather.json' },
    mark: 'tick',
    encoding: { x: { field: 'temp_max', type: 'quantitative', scale: { domain: [-10, 40] } } },
  };
  await withChart(spec, { 'data/weather.json': rows }, async (provider) => {
    assert.deepEqual(await sql(provider, 'SELECT avg(temp_max) AS mean FROM vacp_handle'), [{ mean: 14 }]);
  });
});

test('an aggregated chart types the fields it aggregates, so SQL over vacp_all aggregates them too', async () => {
  const rows = [
    { weather: 'sun', temp_max: '12.5' },
    { weather: 'sun', temp_max: '15.5' },
    { weather: 'rain', temp_max: '9' },
  ];
  const spec: TopLevelSpec = {
    data: { url: 'data/weather.json' },
    mark: 'bar',
    encoding: {
      x: { field: 'weather', type: 'nominal' },
      y: { aggregate: 'mean', field: 'temp_max', type: 'quantitative' },
    },
  };
  await withChart(spec, { 'data/weather.json': rows }, async (provider) => {
    assert.deepEqual(await sql(provider, 'SELECT max(temp_max) AS warmest FROM vacp_all'), [{ warmest: 15.5 }]);
  });
});

test('a field whose name holds a dot loads by that name', async () => {
  const spec: TopLevelSpec = {
    data: { values: [{ 'temp.max': '12.5' }, { 'temp.max': '15.5' }] },
    mark: 'tick',
    encoding: { x: { field: 'temp\\.max', type: 'quantitative' } },
  };
  await withChart(spec, {}, async (provider) => {
    assert.deepEqual(await sql(provider, 'SELECT sum("temp.max") AS total FROM vacp_handle'), [{ total: 28 }]);
  });
});

test('numbers load exactly when the first fraction comes after DuckDB samples the column', async () => {
  const rows = Array.from({ length: 25_000 }, (_, index) => ({ v: index < 21_000 ? index : index + 0.5 }));
  const spec: TopLevelSpec = {
    data: { values: rows },
    mark: 'tick',
    encoding: { x: { field: 'v', type: 'quantitative' } },
  };
  await withChart(spec, {}, async (provider) => {
    assert.deepEqual(await sql(provider, 'SELECT max(v) AS top FROM vacp_handle'), [{ top: 24_999.5 }]);
  });
});

test('a UTC time axis loads its instants as UTC wall-clock time, whatever the local zone', async () => {
  const spec: TopLevelSpec = {
    data: { values: [{ seen: '2012-06-01T00:00:00Z' }, { seen: '2012-06-02T06:30:00Z' }] },
    mark: 'point',
    encoding: { x: { field: 'seen', type: 'temporal', scale: { type: 'utc' } } },
  };
  await withChart(spec, {}, async (provider) => {
    assert.deepEqual(
      await sql(provider, "SELECT strftime(seen, '%Y-%m-%d %H:%M') AS seen FROM vacp_handle ORDER BY seen"),
      [{ seen: '2012-06-01 00:00' }, { seen: '2012-06-02 06:30' }],
    );
  });
});

test('a data handle names its table and columns in the graph, and its state follows the rows shown without reloading DuckDB', async () => {
  const spec: TopLevelSpec = {
    data: { values: gapminder },
    params: [{ name: 'minimum', value: 0 }],
    transform: [{ filter: 'datum.life_expect >= minimum' }],
    mark: 'point',
    encoding: { x: { field: 'country', type: 'nominal' }, y: { field: 'life_expect', type: 'quantitative' } },
  };
  await withChart(spec, {}, async (provider, db, view) => {
    const observe = async () => {
      const { graph, state } = await provider.observe();
      const handle = graph.nodes.find((node) => node.kind === 'DataHandle')!;
      return { data: handle.data as VacpDataHandleData, state: state[handle.ref] as VacpDataHandleState };
    };
    const first = await observe();
    assert.ok(db.tables.has(first.data.table));
    assert.deepEqual(
      first.data.columns?.map(({ name, type }) => `${name} ${type}`),
      ['year BIGINT', 'country VARCHAR', 'cluster BIGINT', 'life_expect DOUBLE'],
    );
    assert.deepEqual(first.state, { kind: 'DataHandle', rowCount: 6, selectionWhere: null });
    const loads = db.loads();
    view.signal('minimum', 70);
    await view.runAsync();
    assert.equal((await observe()).state.rowCount, 3);
    assert.equal(db.loads(), loads);
  });
});

test('a host hook adds metadata and stats to a data handle, and its row count wins', async () => {
  const spec: TopLevelSpec = {
    data: { values: gapminder },
    mark: 'point',
    encoding: { x: { field: 'country', type: 'nominal' }, y: { field: 'life_expect', type: 'quantitative' } },
  };
  await withChart(
    spec,
    {},
    async (provider) => {
      const { graph, state } = await provider.observe();
      const handle = graph.nodes.find((node) => node.kind === 'DataHandle')!;
      assert.deepEqual((handle.data as VacpDataHandleData).metadata, { source: 'Gapminder' });
      assert.deepEqual(state[handle.ref], {
        kind: 'DataHandle',
        rowCount: 1_704,
        selectionWhere: null,
        stats: { sampled: true },
      });
    },
    { describe: () => ({ rowCount: 1_704, metadata: { source: 'Gapminder' }, stats: { sampled: true } }) },
  );
});

test('SQL preserves correlated point tuples and rejects an absent selection field', async () => {
  const spec: TopLevelSpec = {
    data: {
      values: [
        { origin: 'USA', cylinders: 4 },
        { origin: 'USA', cylinders: 6 },
        { origin: 'Japan', cylinders: 4 },
        { origin: 'Japan', cylinders: 6 },
      ],
    },
    params: [{ name: 'pick', select: { type: 'point', fields: ['origin', 'cylinders'] } }],
    mark: 'point',
    encoding: { x: { field: 'cylinders', type: 'quantitative' } },
  };
  await withChart(spec, {}, async (provider, _db, view) => {
    const action = (await provider.observe()).graph.actions.find(
      (action) => action.operation.contract === 'vega_lite.set_selection',
    )!;
    const result = await executeVacpAction(provider, {
      callId: 'correlated',
      name: action.name,
      params: {
        ref: 'vacp://app/view/chart/param/pick',
        value: [
          { origin: 'USA', cylinders: 4 },
          { origin: 'Japan', cylinders: 6 },
        ],
      },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(await sql(provider, 'SELECT origin, cylinders FROM vacp_handle ORDER BY origin'), [
      { origin: 'Japan', cylinders: 6 },
      { origin: 'USA', cylinders: 4 },
    ]);
    view.data('pick_store', [{ unit: '', fields: [{ field: 'missing', type: 'E' }], values: [1] }]);
    await view.runAsync();
    const unavailable = await provider.observe();
    assert.match(
      unavailable.graph.nodes.find((node) => node.kind === 'DataHandle')!.availability!.unavailable!,
      /absent from the data handle/,
    );
    await assert.rejects(sql(provider, 'SELECT * FROM vacp_handle'), /absent from the data handle/);
  });
});

test('data handles read the compiled datasets rendered by the host', async () => {
  const spec: TopLevelSpec = { data: { values: [{ x: 1 }] }, mark: 'point' };
  const vgSpec: import('vega').Spec = {
    data: [{ name: 'host_rows', values: [{ x: 42 }] }],
    marks: [{ type: 'symbol', from: { data: 'host_rows' }, encode: { enter: { x: { field: 'x' } } } }],
  };
  const view = new View(parse(vgSpec), { renderer: 'none' });
  await view.runAsync();
  const db = await nodeDuckDb();
  const provider = createVegaLiteProvider({ view, spec, vgSpec, options, data: { duckdb: db.client } });
  try {
    assert.deepEqual(await sql(provider, 'SELECT x::INTEGER AS x FROM vacp_handle'), [{ x: 42 }]);
  } finally {
    provider.dispose!();
    view.finalize();
    db.close();
  }
});

test('identity selections reject SQL projection when the tuple has no row fields', async () => {
  const spec: TopLevelSpec = {
    data: { values: [{ x: 1 }] },
    params: [{ name: 'pick', select: 'point' }],
    mark: 'point',
  };
  await withChart(spec, {}, async (provider, _db, view) => {
    view.data('pick_store', [{ unit: '', _vgsid_: 1 }]);
    await view.runAsync();
    const unavailable = await provider.observe();
    assert.match(
      unavailable.graph.nodes.find((node) => node.kind === 'DataHandle')!.availability!.unavailable!,
      /Identity selections/,
    );
    await assert.rejects(sql(provider, 'SELECT * FROM vacp_handle'), /Identity selections/);
  });
});

for (const [channel, reverse] of [
  ['y', false],
  ['x', true],
] as const) {
  test(`a human ${channel} brush on a reverse=${reverse} scale selects the chart's rows in SQL`, async () => {
    const spec: TopLevelSpec = {
      data: { values: [{ value: 1 }, { value: 3 }, { value: 5 }, { value: 7 }] },
      params: [{ name: 'brush', select: { type: 'interval', encodings: [channel] } }],
      mark: 'point',
      encoding: { [channel]: { field: 'value', type: 'quantitative', scale: { reverse } } },
    };
    await withChart(spec, {}, async (provider, _db, view) => {
      const scale = view.scale(channel);
      const endpoints = [scale(3), scale(5)].sort((a, b) => a - b).map((pixel) => scale.invert(pixel));
      assert.deepEqual(endpoints, [5, 3]);
      view.change(
        'brush_store',
        changeset().insert({
          unit: '',
          fields: [{ field: 'value', channel, type: 'R' }],
          values: [endpoints],
        }),
      );
      await view.runAsync();
      assert.deepEqual(await sql(provider, 'SELECT value FROM vacp_handle ORDER BY value'), [
        { value: 3 },
        { value: 5 },
      ]);
    });
  });
}

test('a nominal-x interval brush selects each included category in SQL', async () => {
  const spec: TopLevelSpec = {
    data: {
      values: [
        { category: 'a', amount: 1 },
        { category: 'b', amount: 2 },
        { category: 'c', amount: 3 },
      ],
    },
    params: [{ name: 'brush', select: { type: 'interval', encodings: ['x'] } }],
    mark: 'bar',
    encoding: { x: { field: 'category', type: 'nominal' }, y: { field: 'amount', type: 'quantitative' } },
  };
  await withChart(spec, {}, async (provider, _db, view) => {
    view.change(
      'brush_store',
      changeset().insert({
        unit: '',
        fields: [{ field: 'category', channel: 'x', type: 'E' }],
        values: [['a', 'b']],
      }),
    );
    await view.runAsync();
    assert.deepEqual(await sql(provider, 'SELECT category FROM vacp_handle ORDER BY category'), [
      { category: 'a' },
      { category: 'b' },
    ]);
  });
});

test('a discrete interval with an unrepresentable member makes its data handle unavailable', async () => {
  const spec: TopLevelSpec = {
    data: {
      values: [
        { category: 'a', amount: 1 },
        { category: 'b', amount: 2 },
      ],
    },
    params: [{ name: 'brush', select: { type: 'interval', encodings: ['x'] } }],
    mark: 'bar',
    encoding: { x: { field: 'category', type: 'nominal' }, y: { field: 'amount', type: 'quantitative' } },
  };
  await withChart(spec, {}, async (provider, _db, view) => {
    await provider.observe();
    view.change(
      'brush_store',
      changeset().insert({
        unit: '',
        fields: [{ field: 'category', channel: 'x', type: 'E' }],
        values: [['a', Number.NaN]],
      }),
    );
    await view.runAsync();
    const { graph } = await provider.observe();
    const handle = graph.nodes.find((node) => node.ref === 'vacp://app/view/chart/data/main')!;
    assert.match(handle.availability?.unavailable ?? '', /literal/);
  });
});

test('a reversed temporal brush orders instants before rounding the inclusive boundaries', async () => {
  const start = Date.UTC(2012, 5, 1);
  const spec: TopLevelSpec = {
    data: { values: [0, 1, 2, 3].map((offset) => ({ time: start + offset, row_index: offset })) },
    params: [{ name: 'brush', select: { type: 'interval', encodings: ['x'] } }],
    mark: 'point',
    encoding: { x: { field: 'time', type: 'temporal', scale: { type: 'utc', reverse: true } } },
  };
  await withChart(spec, {}, async (provider, _db, view) => {
    await provider.observe();
    view.change(
      'brush_store',
      changeset().insert({
        unit: '',
        fields: [{ field: 'time', channel: 'x', type: 'R' }],
        values: [[start + 2.8, start + 0.2]],
      }),
    );
    await view.runAsync();
    assert.deepEqual(await sql(provider, 'SELECT row_index::INT AS row_index FROM vacp_handle ORDER BY row_index'), [
      { row_index: 1 },
      { row_index: 2 },
    ]);
  });
});
