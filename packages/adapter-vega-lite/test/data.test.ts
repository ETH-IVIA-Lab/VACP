import assert from 'node:assert/strict';
import test from 'node:test';
import type { VacpProvider } from '@vacp/protocol';
import { executeVacpAction } from '@vacp/runtime';
import { View, loader, parse } from 'vega';
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

/** Run SQL against a provider's first data handle and return its rows. */
async function sql(provider: VacpProvider, text: string) {
  const { graph } = await provider.observe();
  const handle = graph.nodes.find((node) => node.kind === 'DataHandle')!;
  const action = graph.actions.find((each) => each.operation.contract === 'vacp.data_sql')!;
  const result = await executeVacpAction(provider, {
    callId: text,
    name: action.name,
    params: { handleRef: handle.ref, sql: text },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return (result.result as { rows: Record<string, unknown>[] }).rows;
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
  return result.result as { columns: Array<{ name: string }>; vacp_all?: { columns: Array<{ name: string }> } };
}

test('layer sources keep distinct handles, each answering over its own rows', async () => {
  const db = await nodeDuckDb();
  const spec: TopLevelSpec = {
    layer: [
      { data: { values: [{ category: 'left', value: 1 }] }, mark: 'point' },
      { data: { values: [{ category: 'right', value: 2 }] }, mark: 'point' },
    ],
  };
  const view = await render(spec);
  const provider = createVegaLiteProvider({ view, spec, options: { ...options, duckdbClient: db.client } });
  try {
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
        return (result.result as { rows: Array<{ category: string }> }).rows.map((row) => row.category);
      }),
    );
    assert.deepEqual(categories.flat().sort(), ['left', 'right']);
  } finally {
    provider.dispose?.();
    view.finalize();
    db.close();
  }
});

test('a dataset change reloads its rows once, and the schema reads the new columns', async () => {
  const db = await nodeDuckDb();
  const initial = Array.from({ length: 8 }, (_, index) => ({ index, value: index }));
  const spec: TopLevelSpec = { data: { name: 'table', values: initial }, mark: 'point' };
  const view = await render(spec);
  const provider = createVegaLiteProvider({ view, spec, options: { ...options, duckdbClient: db.client } });
  try {
    assert.deepEqual(
      (await schema(provider)).columns.map((column) => column.name),
      ['index', 'value'],
    );
    const loads = db.loads();
    view.data('table', [...initial.slice(0, 7), { index: 7, value: 900, lateColumn: 'visible' }]);
    await view.runAsync();
    assert.ok((await schema(provider)).columns.some((column) => column.name === 'lateColumn'));
    assert.equal(db.loads(), loads + 1);
    await schema(provider);
    assert.equal(db.loads(), loads + 1, 'an unchanged dataset keeps its table');
  } finally {
    provider.dispose?.();
    view.finalize();
    db.close();
  }
});

test('replacing a chart keeps the shared client’s tables until the old binding is disposed', async () => {
  const db = await nodeDuckDb();
  const chart = async (value: string) => {
    const spec: TopLevelSpec = { data: { values: [{ value }] }, mark: 'point' };
    const view = await render(spec);
    return { view, provider: createVegaLiteProvider({ view, spec, options: { ...options, duckdbClient: db.client } }) };
  };
  const original = await chart('original');
  const replacement = await chart('replacement');
  try {
    assert.deepEqual(await sql(original.provider, 'SELECT value FROM vacp_handle'), [{ value: 'original' }]);
    assert.deepEqual(await sql(replacement.provider, 'SELECT value FROM vacp_handle'), [{ value: 'replacement' }]);
    original.provider.dispose?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
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
  const db = await nodeDuckDb();
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
  const view = await render(spec, { 'data/gapminder.json': gapminder });
  const provider = createVegaLiteProvider({ view, spec, options: { ...options, duckdbClient: db.client } });
  try {
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
  } finally {
    provider.dispose?.();
    view.finalize();
    db.close();
  }
});

test('an inline source’s filters and calculations reach vacp_handle, and its dates load as timestamps', async () => {
  const db = await nodeDuckDb();
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
  const view = await render(spec);
  const provider = createVegaLiteProvider({ view, spec, options: { ...options, duckdbClient: db.client } });
  try {
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
  } finally {
    provider.dispose?.();
    view.finalize();
    db.close();
  }
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
  const provider = createVegaLiteProvider({ view, spec, options: { ...options, duckdbClient: db.client } });
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
