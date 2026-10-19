import assert from 'node:assert/strict';
import test from 'node:test';
import { Selection, clauseInterval, clauseList, clausePoints } from '@uwdata/mosaic-core';
import { Menu, Search, Slider } from '@uwdata/mosaic-inputs';
import { Interval1D, Toggle } from '@uwdata/mosaic-plot';
import { sql } from '@uwdata/mosaic-sql';
import { executeVacpAction } from '@ethivia/vacp-runtime';
import { createVgplotProvider } from '../src/index';
import { nodeDuckDb } from './duckdb';

const options = { appId: 'test', viewId: 'contracts' };
const ref = 'vacp://test/contracts/plot/interactor/0';

async function execute(provider: ReturnType<typeof createVgplotProvider>, contract: string, params: unknown) {
  const action = (await provider.observe()).graph.actions.find((action) => action.operation.contract === contract)!;
  const result = await executeVacpAction(provider, { callId: contract, name: action.name, params });
  assert.ok(result.ok, JSON.stringify(result));
  return result.result;
}

test('captured point selections restore every tuple past the model preview boundary', async () => {
  const selection = Selection.crossfilter();
  const interactor = Object.assign(Object.create(Toggle.prototype), {
    selection,
    value: null,
    clause(value: number[][] | null) {
      return clausePoints(['x'], value, { source: this });
    },
  });
  const provider = createVgplotProvider({
    plots: [{ plotId: 'plot', plot: { marks: [], interactors: [interactor] } }],
    options,
  });
  const points = Array.from({ length: 80 }, (_, index) => [index]);
  try {
    await execute(provider, 'vgplot.set_toggle', { ref, value: points });
    const state = (await provider.observe()).state;
    assert.deepEqual(state[ref], { kind: 'Toggle', plotId: 'plot', selectionValue: points });
    await execute(provider, 'vgplot.clear_toggle', { ref });
    await execute(provider, 'vacp.apply_state', { state });
    assert.deepEqual(selection.valueFor(interactor), points);
  } finally {
    provider.dispose!();
  }
});

test('point clause failures occur before the interactor value changes', async () => {
  const interactor = Object.assign(Object.create(Toggle.prototype), {
    value: [[1]],
    selection: Selection.single(),
    clause() {
      throw new Error('cannot translate points');
    },
  });
  const provider = createVgplotProvider({
    plots: [{ plotId: 'plot', plot: { marks: [], interactors: [interactor] } }],
    options,
  });
  try {
    const action = (await provider.observe()).graph.actions.find(
      (action) => action.operation.contract === 'vgplot.set_toggle',
    )!;
    await assert.rejects(
      provider.prepare({ callId: 'invalid', name: action.name, params: { ref, value: [[2]] } }),
      /cannot translate points/,
    );
    assert.deepEqual(interactor.value, [[1]]);
  } finally {
    provider.dispose!();
  }
});

test('native Mosaic date predicates select the expected rows through data SQL', async () => {
  const db = await nodeDuckDb();
  await db.client.exec(
    "CREATE TABLE weather AS SELECT * FROM (VALUES (DATE '2012-06-01'), (DATE '2012-07-01'), (DATE '2012-09-01')) AS t(day)",
  );
  const selection = Selection.crossfilter();
  const interactor = Object.assign(Object.create(Interval1D.prototype), {
    channel: 'x',
    selection,
    scale: { domain: [new Date('2012-01-01'), new Date('2013-01-01')], apply: Number },
    clause(value: [Date, Date] | null) {
      return clauseInterval(sql`make_date(2012, month(day), day(day))`, value, { source: this });
    },
  });
  const provider = createVgplotProvider({
    plots: [
      {
        plotId: 'plot',
        plot: { marks: [{ sourceTable: () => 'weather', filterBy: selection }], interactors: [interactor] },
      },
    ],
    options,
    data: { duckdb: db.client },
  });
  try {
    await execute(provider, 'vgplot.set_interval_1d', { ref, min: Date.UTC(2012, 5, 1), max: Date.UTC(2012, 7, 31) });
    const result = await execute(provider, 'vacp.data_sql', {
      handleRef: 'vacp://test/contracts/data/main',
      sql: 'SELECT count(*)::INTEGER AS n FROM vacp_handle',
    });
    assert.ok(result && typeof result === 'object' && 'rows' in result);
    assert.deepEqual(result.rows, [{ n: 2 }]);
  } finally {
    provider.dispose!();
    db.close();
  }
});

test('native Mosaic list predicates retain list membership in selected SQL', async () => {
  const db = await nodeDuckDb();
  await db.client.exec("CREATE TABLE lists AS SELECT * FROM (VALUES (1, ['a', 'b']), (2, ['c'])) AS t(id, tags)");
  const selection = Selection.single();
  selection.update(clauseList('tags', ['b'], { source: {} }));
  await selection.pending('value');
  const provider = createVgplotProvider({
    plots: [
      { plotId: 'plot', plot: { marks: [{ sourceTable: () => 'lists', filterBy: selection }], interactors: [] } },
    ],
    options,
    data: { duckdb: db.client },
  });
  try {
    const result = await execute(provider, 'vacp.data_sql', {
      handleRef: 'vacp://test/contracts/data/main',
      sql: 'SELECT id FROM vacp_handle',
    });
    assert.ok(result && typeof result === 'object' && 'rows' in result);
    assert.deepEqual(result.rows, [{ id: 1 }]);
  } finally {
    provider.dispose!();
    db.close();
  }
});

test('a native selection SQL failure disables the handle and rejects its query', async () => {
  const db = await nodeDuckDb();
  const provider = createVgplotProvider({
    plots: [
      {
        plotId: 'plot',
        plot: {
          marks: [
            {
              sourceTable: () => 'rows',
              filterBy: {
                predicate: () => {
                  throw new Error('predicate failed');
                },
              },
            },
          ],
          interactors: [],
        },
      },
    ],
    options,
    data: { duckdb: db.client },
  });
  try {
    const observation = await provider.observe();
    const handle = observation.graph.nodes.find((node) => node.kind === 'DataHandle')!;
    assert.equal(handle.availability?.unavailable, 'predicate failed');
    const action = observation.graph.actions.find((action) => action.operation.contract === 'vacp.data_sql')!;
    const result = await executeVacpAction(provider, {
      callId: 'query',
      name: action.name,
      params: { handleRef: handle.ref, sql: 'SELECT * FROM vacp_handle' },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error.message, /predicate failed/);
  } finally {
    provider.dispose!();
    db.close();
  }
});

test('day-of-year brushes preserve the numeric predicate and UTC date endpoints', async () => {
  const db = await nodeDuckDb();
  await db.client.exec('CREATE TABLE days AS SELECT * FROM (VALUES (151), (152), (213), (244)) AS t(day)');
  const selection = Selection.crossfilter();
  const interactor = Object.assign(Object.create(Interval1D.prototype), {
    channel: 'x',
    selection,
    scale: { domain: [0, 365], apply: Number },
    clause(value: [number, number] | null) {
      return clauseInterval('day', value, { source: this });
    },
  });
  const provider = createVgplotProvider({
    plots: [
      {
        plotId: 'plot',
        plot: { marks: [{ sourceTable: () => 'days', filterBy: selection }], interactors: [interactor] },
      },
    ],
    options,
    data: { duckdb: db.client },
  });
  try {
    await execute(provider, 'vgplot.set_interval_1d', { ref, min: '2012-06-01', max: '2012-08-01' });
    assert.deepEqual(selection.valueFor(interactor), [152, 213]);
    const result = await execute(provider, 'vacp.data_sql', {
      handleRef: 'vacp://test/contracts/data/main',
      sql: 'SELECT day FROM vacp_handle ORDER BY day',
    });
    assert.ok(result && typeof result === 'object' && 'rows' in result);
    assert.deepEqual(result.rows, [{ day: 152 }, { day: 213 }]);
  } finally {
    provider.dispose!();
    db.close();
  }
});

function inputRoot(inputs: object[]) {
  const elements = inputs.map((value) =>
    Object.assign(Object.create(null), {
      value,
      querySelector: () => null,
    }),
  );
  return Object.assign(Object.create(null), { querySelectorAll: () => elements });
}

function menu(value: unknown = 'a') {
  return Object.assign(Object.create(Menu.prototype), {
    data: [{ value, label: 'First' }],
    selectedValue: () => value,
    select: Object.assign(new EventTarget(), { value: 'a', selectedIndex: 0, options: [{ label: 'First' }] }),
  });
}

test('a from-backed Search has no indexed menu options', async (t) => {
  const search = Object.assign(Object.create(Search.prototype), {
    from: 'athletes',
    column: 'name',
    data: [{ list: ['Ann', 'Bob'] }],
    searchbox: Object.assign(new EventTarget(), { value: '' }),
  });
  const provider = createVgplotProvider({ root: inputRoot([search]), plots: [], options });
  t.after(() => provider.dispose!());
  const { graph } = await provider.observe();
  assert.equal(
    graph.actions.some((action) => action.operation.contract === 'vgplot.set_input_option_index'),
    false,
  );
  const result = await execute(provider, 'vacp.widget_options', { ref: 'vacp://test/contracts/input/0' });
  assert.ok(result && typeof result === 'object' && 'options' in result);
  assert.deepEqual(result.options, []);
});

test('indexed option preparation rejects a Search even when the dashboard also has a Menu', async (t) => {
  const search = Object.assign(Object.create(Search.prototype), {
    from: 'athletes',
    data: [{ list: ['Ann', 'Bob'] }],
    searchbox: Object.assign(new EventTarget(), { value: '' }),
  });
  const provider = createVgplotProvider({ root: inputRoot([search, menu()]), plots: [], options });
  t.after(() => provider.dispose!());
  const action = (await provider.observe()).graph.actions.find(
    (action) => action.operation.contract === 'vgplot.set_input_option_index',
  )!;
  await assert.rejects(
    provider.prepare({
      callId: 'search',
      name: action.name,
      params: { ref: 'vacp://test/contracts/input/0', index: 0 },
    }),
    /indexed options/,
  );
  assert.equal(search.searchbox.value, '');
});

for (const [requested, held] of [
  [12.5, 13],
  [500, 100],
]) {
  test(`a Slider result reports the control's ${held} after requesting ${requested}`, async (t) => {
    const control = Object.assign(new EventTarget(), { value: '1', valueAsNumber: 1 });
    // Model the browser's range sanitization at the control boundary.
    control.addEventListener('input', () => {
      control.value = String(held);
      control.valueAsNumber = held;
    });
    const slider = Object.assign(Object.create(Slider.prototype), { slider: control });
    const provider = createVgplotProvider({ root: inputRoot([slider]), plots: [], options });
    t.after(() => provider.dispose!());
    const result = await execute(provider, 'vgplot.set_input_value', {
      ref: 'vacp://test/contracts/input/0',
      value: requested,
    });
    assert.deepEqual(result, { set: true, value: held });
    const state = (await provider.observe()).state['vacp://test/contracts/input/0'];
    assert.ok(state && typeof state === 'object' && 'selectionValue' in state);
    assert.equal(state.selectionValue, held);
  });
}

for (const [label, value] of [
  ['non-finite', Number.NaN],
  ['invalid date', new Date(Number.NaN)],
  ['non-plain', new Map([['x', 1]])],
  [
    'cycle',
    (() => {
      const value: unknown[] = [];
      value.push(value);
      return value;
    })(),
  ],
] as const) {
  test(`a ${label} selection fails its own ref while other dashboard state remains readable`, async (t) => {
    const interactor = Object.assign(Object.create(Interval1D.prototype), {
      channel: 'x',
      scale: { domain: [0, 100], apply: Number },
      selection: { valueFor: () => value },
    });
    const provider = createVgplotProvider({
      root: inputRoot([menu(value), menu('healthy')]),
      plots: [{ plotId: 'plot', plot: { marks: [], interactors: [interactor] } }],
      tables: [{ tableId: 'table', table: { selection: { value } } }],
      options,
    });
    t.after(() => provider.dispose!());
    const { state } = await provider.observe();
    for (const [targetRef, kind] of [
      ['vacp://test/contracts/input/0', 'Widget'],
      [ref, 'Interval1D'],
      ['vacp://test/contracts/table', 'Table'],
    ] as const) {
      const entry = state[targetRef!];
      assert.ok(entry && typeof entry === 'object' && 'readError' in entry);
      assert.equal(typeof entry.readError, 'string');
      assert.deepEqual(Object.keys(entry).sort(), ['kind', 'readError']);
      assert.equal('kind' in entry && entry.kind, kind);
    }
    assert.deepEqual(state['vacp://test/contracts/input/1'], {
      kind: 'Widget',
      widgetKind: 'Menu',
      selectionValue: 'healthy',
      optionCount: 1,
    });
    const result = await execute(provider, 'vacp.widget_options', { ref: 'vacp://test/contracts/input/0' });
    assert.ok(result && typeof result === 'object' && 'readError' in result);
    assert.equal(typeof result.readError, 'string');
    assert.equal('kind' in result && result.kind, 'Widget');
  });
}

test('a legend capture error leaves sibling refs readable', async (t) => {
  const provider = createVgplotProvider({
    root: inputRoot([menu('healthy')]),
    plots: [
      {
        plotId: 'plot',
        plot: {
          marks: [],
          interactors: [],
          legends: [
            {
              legend: {
                channel: 'color',
                selection: { value: Number.NaN },
              },
            },
          ],
        },
      },
    ],
    options,
  });
  t.after(() => provider.dispose!());
  const { state } = await provider.observe();
  assert.deepEqual(state['vacp://test/contracts/plot/legend/0'], {
    kind: 'Legend',
    readError: 'Selection contains a non-finite number',
  });
  assert.ok(state['vacp://test/contracts/input/0']);
});

test('an interval domain capture error leaves sibling refs readable', async (t) => {
  const interactor = Object.assign(Object.create(Interval1D.prototype), {
    channel: 'x',
    scale: { domain: [0, Number.NaN], apply: Number },
  });
  const provider = createVgplotProvider({
    root: inputRoot([menu('healthy')]),
    plots: [{ plotId: 'plot', plot: { marks: [], interactors: [interactor] } }],
    options,
  });
  t.after(() => provider.dispose!());
  const { state } = await provider.observe();
  assert.deepEqual(state[ref], { kind: 'Interval1D', readError: 'Selection contains a non-finite number' });
  assert.ok(state['vacp://test/contracts/input/0']);
});
