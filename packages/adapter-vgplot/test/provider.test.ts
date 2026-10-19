import type { VgplotInteractorLike } from '../src/types';
import { Interval1D, PanZoom, Toggle } from '@uwdata/mosaic-plot';
import { ExprNode, count, sql } from '@uwdata/mosaic-sql';
import { createVgplotPresentation } from '../src/presentation';
import { nodeDuckDb } from './duckdb';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { VacpDataHandleState } from '@ethivia/vacp-protocol';
import { createVacpRuntime } from '@ethivia/vacp-runtime';
import { createVgplotProvider, type VgplotPlotLike } from '../src/index';

/** An instance of a Mosaic class with only the fields a test needs; its constructor needs a rendered mark. */
function mosaic<Fields extends object>(
  type: abstract new (...args: never[]) => unknown,
  fields: Fields & VgplotInteractorLike,
) {
  return Object.assign(Object.create(type.prototype) as object, fields) as VgplotInteractorLike & Fields;
}

test('table actions resolve their explicit target ref', async () => {
  const table = { sortColumn: 'x', sortDesc: true, update: () => undefined };
  const provider = createVgplotProvider({
    plots: [],
    tables: [{ tableId: 'table', table }],
    options: { appId: 'test', viewId: 'table' },
  });
  const runtime = createVacpRuntime({ providers: [provider] });
  try {
    const graph = (await runtime.getCapabilities()).graph;
    const action = graph.actions.find((action) => action.operation.contract === 'vgplot.table_clear_sort')!;
    assert.equal(
      (await runtime.execute({ callId: 'clear', name: action.name, params: { ref: 'vacp://test/table/table' } })).ok,
      true,
    );
    assert.equal(table.sortColumn, null);
    assert.equal(table.sortDesc, false);
  } finally {
    runtime.dispose();
  }
});

test('provider subscriptions release selection patches and rebind the same live dashboard', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const selection = {
    value: 0,
    update: (value: unknown) => {
      selection.value = Number(value);
    },
  };
  const original = selection.update;
  const init = () => {};
  const interactor: VgplotInteractorLike = mosaic(Toggle, { selection, init });
  const plot: VgplotPlotLike = { marks: [], interactors: [interactor] };
  const create = () =>
    createVgplotProvider({
      plots: [{ plotId: 'scatter', plot }],
      options: { appId: 'test', viewId: 'overview' },
    });
  const first = create();
  assert.equal(selection.update, original);
  let firstChanges = 0;
  const detach = first.subscribe!(() => firstChanges++);
  selection.update(1);
  detach();
  t.mock.timers.tick(120);
  assert.equal(firstChanges, 0);
  assert.equal(selection.update, original);
  assert.equal(interactor.init, init);
  first.dispose!();
  const second = create();
  let changes = 0;
  second.subscribe!(() => changes++);
  selection.update(2);
  t.mock.timers.tick(120);
  assert.equal(changes, 1);
  second.dispose!();
  assert.equal(selection.update, original);
  assert.equal(interactor.init, init);
});

test('failed dashboard binding rolls back patches and isolates consumer failures', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const selection = { update: () => {} };
  const original = selection.update;
  const interactor: VgplotInteractorLike = mosaic(Toggle, { selection });
  Object.defineProperty(interactor, 'init', { value: () => {}, writable: false, configurable: true });
  const provider = createVgplotProvider({
    plots: [{ plotId: 'chart', plot: { marks: [], interactors: [interactor] } }],
    options: { appId: 'test', viewId: 'failure' },
  });
  assert.throws(() => provider.subscribe!(() => {}), TypeError);
  assert.equal(selection.update, original);
  Object.defineProperty(interactor, 'init', { writable: true });
  provider.subscribe!(() => {
    throw new Error('consumer failed');
  });
  let changes = 0;
  provider.subscribe!(() => changes++);
  selection.update();
  t.mock.timers.tick(120);
  assert.equal(changes, 1);
  provider.dispose!();
  assert.equal(selection.update, original);
});

test('preparation validates complete table and axis mutations before changing native state', async () => {
  const table = { schema: [{ column: 'x' }], sortColumn: 'x', offset: 0, limit: 10, update() {} };
  const axes: unknown[] = [];
  const pan: VgplotInteractorLike = mosaic(PanZoom, {
    xscale: { domain: [0, 20], apply: (value) => Number(value) },
    yscale: { domain: () => [0, 20], apply: (value) => Number(value) },
    xsel: { update: (value) => axes.push(value) },
    ysel: { update: (value) => axes.push(value) },
    clause: (value) => value,
  });
  const provider = createVgplotProvider({
    plots: [{ plotId: 'plot', plot: { marks: [], interactors: [pan] } }],
    tables: [{ tableId: 'table', table }],
    options: { appId: 'test', viewId: 'prepared' },
  });
  try {
    const { graph } = await provider.observe();
    const call = (contract: string, params: Record<string, unknown>) => ({
      callId: contract,
      name: graph.actions.find((action) => action.operation.contract === contract)!.name,
      params: {
        ref: contract.startsWith('vgplot.table_')
          ? 'vacp://test/prepared/table'
          : 'vacp://test/prepared/plot/interactor/0',
        ...params,
      },
    });
    await assert.rejects(
      provider.prepare(call('vgplot.table_set_sort', { column: 'missing' })),
      /Unknown table column/,
    );
    await assert.rejects(provider.prepare(call('vgplot.table_set_page', { offset: 20, limit: 'invalid' })), /finite/);
    await assert.rejects(
      provider.prepare(call('vgplot.set_pan_zoom', { x0: 0, x1: 10, y0: 0, y1: 'bad' })),
      /numeric y0/,
    );
    assert.equal(table.offset, 0);
    assert.equal(table.limit, 10);
    assert.equal(axes.length, 0);
    const zoom = await provider.prepare(call('vgplot.set_pan_zoom', { x0: 0, x1: 10, y0: 0, y1: 10 }));
    assert.deepEqual(zoom.intent.focus?.interaction, { kind: 'zoom', direction: 'in' });
    const panning = await provider.prepare(call('vgplot.set_pan_zoom', { x0: 10, x1: 30 }));
    assert.deepEqual(panning.intent.focus?.interaction, { kind: 'pan' });
    pan.ysel = { update: (value) => axes.push(value) };
    assert.equal((await zoom.execute()).ok, false);
    assert.equal(axes.length, 0);
    const plan = await provider.prepare(call('vgplot.table_set_page', { offset: 20, limit: 5 }));
    assert.equal(table.offset, 0);
    assert.equal((await plan.execute()).ok, true);
    assert.equal(table.offset, 20);
    assert.equal(table.limit, 5);
    await assert.rejects(plan.execute(), /already been executed/);
  } finally {
    provider.dispose?.();
  }
});

test('restoration validates every bound target before applying any supported state', async () => {
  const first = { schema: [{ column: 'x' }], sortColumn: 'x', update() {} };
  const second = { schema: [{ column: 'y' }], sortColumn: 'y', update() {} };
  const provider = createVgplotProvider({
    plots: [],
    tables: [
      { tableId: 'one', table: first },
      { tableId: 'two', table: second },
    ],
    options: { appId: 'test', viewId: 'restoration' },
  });
  try {
    const { graph } = await provider.observe();
    const tables = graph.nodes.filter((node) => node.kind === 'Visualization');
    const action = graph.actions.find((candidate) => candidate.operation.contract === 'vacp.apply_state')!;
    await assert.rejects(
      provider.prepare({
        callId: 'invalid',
        name: action.name,
        params: {
          state: {
            [tables[0]!.ref]: { sortColumn: null },
            [tables[1]!.ref]: { sortColumn: 'missing' },
          },
        },
      }),
      /Unknown table column/,
    );
    assert.equal(first.sortColumn, 'x');
    assert.equal(second.sortColumn, 'y');
  } finally {
    provider.dispose?.();
  }
});

test('shared native resources retain one instrumentation owner through out-of-order disposal', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const selection = { update: (value: unknown) => value };
  const pendingResult = {};
  const renderResult = Promise.resolve('rendered');
  const plot: VgplotPlotLike = {
    marks: [],
    interactors: [mosaic(Toggle, { selection })],
    pending: () => pendingResult,
    render: () => renderResult,
  };
  const originalUpdate = selection.update,
    originalPending = plot.pending,
    originalRender = plot.render;
  const create = () =>
    createVgplotProvider({ plots: [{ plotId: 'plot', plot }], options: { appId: 'test', viewId: 'shared' } });
  const first = create(),
    second = create();
  let changes = 0;
  first.subscribe!(() => {});
  const wrappedUpdate = selection.update;
  second.subscribe!(() => {
    changes++;
  });
  assert.equal(selection.update, wrappedUpdate);
  first.dispose!();
  assert.equal(selection.update('same-result'), 'same-result');
  assert.equal(plot.pending!(), pendingResult);
  assert.equal(plot.render!(), renderResult);
  await renderResult;
  t.mock.timers.tick(120);
  assert.equal(changes, 1);
  assert.equal(Object.values((await second.observe()).freshness ?? {})[0]?.status, 'current');
  second.dispose!();
  assert.equal(selection.update, originalUpdate);
  assert.equal(plot.pending, originalPending);
  assert.equal(plot.render, originalRender);
});

test('a prepared operation cannot mutate an interactor replaced within its native plot', async () => {
  let writes = 0;
  const interactor: VgplotInteractorLike = mosaic(Toggle, {
    selection: {
      update: () => {
        writes++;
      },
    },
    clause: (value) => value,
  });
  const plot: VgplotPlotLike = { marks: [], interactors: [interactor] };
  const provider = createVgplotProvider({
    plots: [{ plotId: 'plot', plot }],
    options: { appId: 'test', viewId: 'replacement' },
  });
  try {
    const { graph } = await provider.observe();
    const action = graph.actions.find((candidate) => candidate.operation.contract === 'vgplot.set_toggle')!;
    const plan = await provider.prepare({
      callId: 'old-binding',
      name: action.name,
      params: { ref: 'vacp://test/replacement/plot/interactor/0', value: 'x' },
    });
    plot.interactors[0] = { ...interactor };
    const result = await plan.execute();
    assert.equal(result.ok, false);
    assert.equal(writes, 0);
  } finally {
    provider.dispose?.();
  }
});

test('late observation setup cannot change a native initialization result', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const readonlySelection = Object.freeze({ update: () => {} });
  const result = Promise.resolve('initialized');
  const interactor: VgplotInteractorLike = mosaic(Toggle, {
    selection: { update: () => {} },
    init() {
      this.selection = readonlySelection;
      return result;
    },
  });
  const provider = createVgplotProvider({
    plots: [{ plotId: 'plot', plot: { marks: [], interactors: [interactor] } }],
    options: { appId: 'test', viewId: 'late-binding' },
  });
  try {
    let changes = 0;
    provider.subscribe!(() => {
      changes++;
    });
    assert.equal(interactor.init!({} as SVGElement), result);
    assert.equal(await result, 'initialized');
    t.mock.timers.tick(120);
    assert.equal(changes, 1);
    assert.equal(interactor.selection, readonlySelection);
    await provider.observe();
  } finally {
    provider.dispose?.();
  }
});

test('pan and zoom semantics use the rendered domain after prior programmatic changes', async () => {
  let domain = [0, 20];
  const cached = { domain: [0, 20], apply: Number };
  const pan: VgplotInteractorLike = mosaic(PanZoom, {
    xscale: cached,
    svg: { scale: () => ({ domain, apply: Number }) },
    xsel: {
      update: (value) => {
        domain = value as number[];
      },
    },
    clause: (value) => value,
  });
  const provider = createVgplotProvider({
    plots: [{ plotId: 'plot', plot: { marks: [], interactors: [pan] } }],
    options: { appId: 'test', viewId: 'live-domain' },
  });
  try {
    const { graph } = await provider.observe();
    const action = graph.actions.find((candidate) => candidate.operation.contract === 'vgplot.set_pan_zoom')!;
    for (const [x0, x1, interaction] of [
      [0, 10, { kind: 'zoom', direction: 'in' }],
      [10, 20, { kind: 'pan' }],
      [0, 20, { kind: 'zoom', direction: 'out' }],
    ] as const) {
      const plan = await provider.prepare({
        callId: String(x0),
        name: action.name,
        params: { ref: 'vacp://test/live-domain/plot/interactor/0', x0, x1 },
      });
      assert.deepEqual(plan.intent.focus?.interaction, interaction);
      assert.equal((await plan.execute()).ok, true);
      assert.deepEqual(domain, [x0, x1]);
    }
    assert.deepEqual(cached.domain, [0, 20]);
  } finally {
    provider.dispose?.();
  }
});

test('interval preparation orders domain and inverted-axis brush extents before mutation', async () => {
  const writes: unknown[] = [];
  const brushes: unknown[] = [];
  const interactor: VgplotInteractorLike = mosaic(Interval1D, {
    channel: 'y',
    scale: { domain: [0, 100], apply: (value) => 100 - Number(value) },
    selection: { update: (value) => writes.push(value) },
    clause: (value) => value,
    brush: { moveSilent() {} },
    g: { call: (_, value) => brushes.push(value) },
  });
  const provider = createVgplotProvider({
    plots: [{ plotId: 'plot', plot: { marks: [], interactors: [interactor] } }],
    options: { appId: 'test', viewId: 'interval' },
  });
  try {
    const { graph } = await provider.observe();
    const action = graph.actions.find((action) => action.operation.contract === 'vgplot.set_interval_1d')!;
    const call = {
      callId: 'range',
      name: action.name,
      params: { ref: 'vacp://test/interval/plot/interactor/0', min: 60, max: 20 },
    };
    const plan = await provider.prepare(call);
    assert.deepEqual(writes, []);
    assert.deepEqual(brushes, []);
    assert.equal((await plan.execute()).ok, true);
    assert.deepEqual(writes, [[20, 60]]);
    assert.deepEqual(brushes, [[40, 80]]);
    interactor.clause = () => {
      throw new Error('Invalid native field');
    };
    await assert.rejects(provider.prepare(call), /Invalid native field/);
    assert.equal(brushes.length, 1);
    assert.equal(writes.length, 1);
  } finally {
    provider.dispose?.();
  }
});

test('presentation belongs to one live provider generation', () => {
  const create = () => createVgplotProvider({ plots: [], options: { appId: 'test', viewId: 'presentation' } });
  const first = create();
  const second = create();
  // Creating presentation does not touch DOM or install observers.
  const root = {} as HTMLElement;
  assert.equal(typeof createVgplotPresentation({ provider: first, root }).resolve, 'function');
  first.dispose!();
  assert.throws(() => createVgplotPresentation({ provider: first, root }), /live .* provider/);
  assert.equal(typeof createVgplotPresentation({ provider: second, root }).resolve, 'function');
  second.dispose!();
});

test('shared selection provenance restores its active source after all clause values', async () => {
  type Clause = { source: VgplotInteractorLike | null; value: unknown };
  const clauses = new Map<VgplotInteractorLike | null, unknown>();
  const selection = {
    active: { source: null } as Clause,
    valueFor: (source: VgplotInteractorLike) => clauses.get(source) ?? null,
    update(raw: unknown) {
      const clause = raw as Clause;
      this.active = clause;
      clauses.set(clause.source, clause.value);
    },
  };
  const interval = (): VgplotInteractorLike =>
    mosaic(Interval1D, {
      selection,
      scale: { domain: [0, 100], apply: Number },
      clause(value) {
        return { source: this, value };
      },
    });
  const first = interval();
  const second = interval();
  selection.update({ source: first, value: [10, 20] });
  const provider = createVgplotProvider({
    plots: [
      { plotId: 'first', plot: { marks: [], interactors: [first] } },
      { plotId: 'second', plot: { marks: [], interactors: [second] } },
    ],
    options: { appId: 'test', viewId: 'active-source' },
  });
  const runtime = createVacpRuntime({ providers: [provider] });
  try {
    const recorded = await runtime.inspect();
    const groups = recorded.graph.nodes.filter((node) => node.kind === 'Selection');
    assert.equal(groups.length, 1);
    const group = groups[0]!.ref;
    assert.deepEqual(recorded.state[group], {
      kind: 'Selection',
      activeSource: 'vacp://test/active-source/first/interactor/0',
    });
    selection.update({ source: second, value: [30, 40] });
    const apply = recorded.graph.actions.find((action) => action.operation.contract === 'vacp.apply_state')!;
    const result = await runtime.execute({ callId: 'restore', name: apply.name, params: { state: recorded.state } });
    assert.equal(result.ok, true);
    assert.deepEqual(selection.valueFor(first), [10, 20]);
    assert.equal(selection.valueFor(second), null);
    assert.equal(selection.active.source, first);
    const cleared = { ...recorded.state, [group]: { kind: 'Selection', activeSource: null } };
    assert.equal(
      (await runtime.execute({ callId: 'inactive', name: apply.name, params: { state: cleared } })).ok,
      true,
    );
    assert.equal(selection.active.source, null);
    assert.deepEqual(selection.valueFor(first), [10, 20]);
    assert.equal(selection.valueFor(second), null);
    assert.equal(
      (
        await runtime.execute({
          callId: 'invalid',
          name: apply.name,
          params: { state: { ...cleared, [group]: { activeSource: 'vacp://unknown/source' } } },
        })
      ).ok,
      false,
    );
    assert.equal(selection.active.source, null);
  } finally {
    runtime.dispose();
  }
});

test('a crossfilter shared by several plots filters their data handle once', async () => {
  const selection = { predicate: () => sql`"time" BETWEEN 8 AND 10` };
  const plot = (): VgplotPlotLike => ({
    marks: [{ type: 'rectY', sourceTable: () => 'trips', filterBy: selection }],
    interactors: [mosaic(Interval1D, { selection, channel: 'x', scale: { domain: [0, 24], apply: Number } })],
  });
  const provider = createVgplotProvider({
    plots: ['pickups', 'dropoffs', 'hours'].map((plotId) => ({ plotId, plot: plot() })),
    data: { duckdb: (await nodeDuckDb()).client },
    options: { appId: 'test', viewId: 'taxi' },
  });
  const runtime = createVacpRuntime({ providers: [provider] });
  try {
    const { state } = await runtime.observe();
    const handle = state['vacp://test/taxi/data/main'] as { selectionWhere: string };
    assert.equal(handle.selectionWhere.match(/BETWEEN 8 AND 10/g)?.length, 1);
  } finally {
    runtime.dispose();
  }
});

test('each data handle narrows by the selections that filter views of its own table', async () => {
  const brush = { predicate: () => sql`"time" BETWEEN 8 AND 10` };
  const hover = { predicate: () => '"zone" = 4' };
  const provider = createVgplotProvider({
    plots: [
      {
        plotId: 'hours',
        plot: {
          marks: [{ type: 'rectY', sourceTable: () => 'trips', filterBy: brush }],
          interactors: [
            mosaic(Interval1D, { selection: brush, channel: 'x', scale: { domain: [0, 24], apply: Number } }),
          ],
        },
      },
      {
        plotId: 'zones',
        // The hover only highlights, so no mark is filtered by it.
        plot: { marks: [{ type: 'geo', sourceTable: () => 'zones' }], interactors: [{ selection: hover }] },
      },
    ],
    data: { duckdb: (await nodeDuckDb()).client },
    options: { appId: 'test', viewId: 'taxi' },
  });
  const runtime = createVacpRuntime({ providers: [provider] });
  try {
    const { graph, state } = await runtime.observe();
    const where = Object.fromEntries(
      graph.nodes
        .filter((node) => node.kind === 'DataHandle')
        .map((node) => [
          (node.data as { table: string }).table,
          (state[node.ref] as VacpDataHandleState).selectionWhere,
        ]),
    );
    assert.match(where.trips!, /"time" BETWEEN 8 AND 10/);
    assert.equal(where.zones, null);
  } finally {
    runtime.dispose();
  }
});

test('native custom bin descriptors exclude rendering ownership and retain stable semantic refs', async () => {
  const coordinator = { clients: ['private-client'], cache: new Array(1000).fill('private-row') };
  const nativeMark = { _coordinator: coordinator, data: { rows: ['private-record'] } };
  const bin = Object.assign(new ExprNode('CUSTOM'), {
    column: 'time',
    channel: 'x',
    options: { step: 1, offset: 0 },
    mark: nativeMark,
  });
  const unnamed = Object.assign(new ExprNode('CUSTOM'), { channel: 'color', options: { steps: 12 }, mark: nativeMark });
  const plot: VgplotPlotLike = {
    marks: [
      {
        type: 'rectY',
        channels: [
          { channel: 'x1', field: bin },
          { channel: 'color', field: unnamed },
          { channel: 'y', field: count() },
        ],
      },
    ],
    interactors: [],
  };
  const graph = async () => {
    const provider = createVgplotProvider({
      plots: [{ plotId: 'histogram', plot }],
      options: { appId: 'test', viewId: 'fields' },
    });
    try {
      return (await provider.observe()).graph;
    } finally {
      provider.dispose!();
    }
  };
  const before = await graph();
  coordinator.cache.push('another-private-record');
  nativeMark.data.rows.push('new-rendered-record');
  Object.defineProperty(bin, 'mark', {
    get: () => {
      throw new Error('Graph projection traversed native rendering ownership');
    },
  });
  const after = await graph();
  assert.deepEqual(after, before);
  const fields = after.nodes.filter((node) => node.kind === 'EncodedField');
  assert.deepEqual(fields.find((node) => node.data?.channel === 'x1')?.data?.field, {
    type: 'CUSTOM',
    column: 'time',
    channel: 'x',
    options: { step: 1, offset: 0 },
  });
  const aggregate = fields.find((node) => node.data?.channel === 'y')?.data?.field;
  assert.ok(aggregate && typeof aggregate === 'object' && 'sql' in aggregate);
  assert.match(String(aggregate.sql), /count\(\*\)/i);
});

test('Mosaic interactors keep their actions and kinds when a production build renames their classes', async () => {
  // Minifiers rename classes in place; the class identity VGPlot constructs from stays the same.
  const original = Object.getOwnPropertyDescriptor(Interval1D, 'name')!;
  Object.defineProperty(Interval1D, 'name', { value: 'XI' });
  const brush = mosaic(Interval1D, {
    channel: 'x',
    selection: { update: () => {} },
    scale: { domain: [0, 100], apply: Number },
    clause: (value: unknown) => value,
  });
  const runtime = createVacpRuntime({
    providers: [
      createVgplotProvider({
        plots: [{ plotId: 'age', plot: { marks: [], interactors: [brush] } }],
        options: { appId: 'test', viewId: 'minified' },
      }),
    ],
  });
  try {
    const { graph } = await runtime.getCapabilities();
    const contracts = graph.actions.map((action) => action.operation.contract);
    assert.ok(contracts.includes('vgplot.set_interval_1d'));
    assert.ok(contracts.includes('vgplot.clear_interval_1d'));
    assert.equal(graph.nodes.find((node) => node.kind === 'InteractionTarget')?.title, 'Interval1D');
    const { state } = await runtime.observe();
    const entry = Object.values(state).find((value) => (value as { plotId?: string })?.plotId === 'age');
    assert.equal((entry as { kind?: string }).kind, 'Interval1D');
  } finally {
    Object.defineProperty(Interval1D, 'name', original);
    runtime.dispose();
  }
});

test('an interactor from a second Mosaic copy is reported instead of silently losing its actions', () => {
  class Interval1D {
    selection = { update: () => {} };
  }
  assert.throws(
    () =>
      createVgplotProvider({
        plots: [{ plotId: 'age', plot: { marks: [], interactors: [new Interval1D()] } }],
        options: { appId: 'test', viewId: 'duplicate' },
      }),
    /different copy of @uwdata\/mosaic-plot/,
  );
});

test('a data handle names its table and columns in the graph, and its selection in state', async () => {
  const selection = { predicate: () => sql`"time" BETWEEN 8 AND 10` };
  const db = await nodeDuckDb();
  await db.client.exec('CREATE TABLE trips AS SELECT range::DOUBLE AS time FROM range(12)');
  const provider = createVgplotProvider({
    plots: [
      {
        plotId: 'hours',
        plot: {
          marks: [{ type: 'rectY', sourceTable: () => 'trips', filterBy: selection }],
          interactors: [mosaic(Interval1D, { selection, channel: 'x', scale: { domain: [0, 24], apply: Number } })],
        },
      },
    ],
    data: { duckdb: db.client },
    options: { appId: 'test', viewId: 'taxi' },
  });
  const runtime = createVacpRuntime({ providers: [provider] });
  try {
    const { graph, state } = await runtime.observe();
    const handle = graph.nodes.find((node) => node.kind === 'DataHandle')!;
    assert.deepEqual(handle.data, { table: 'trips', columns: [{ name: 'time', type: 'DOUBLE' }] });
    const { selectionWhere, ...rest } = state[handle.ref] as VacpDataHandleState;
    assert.deepEqual(rest, { kind: 'DataHandle', rowCount: null });
    assert.match(selectionWhere!, /"time" BETWEEN 8 AND 10/);
    const queries = db.queries();
    await runtime.observe();
    assert.equal(db.queries(), queries, 'a table is described once');
  } finally {
    runtime.dispose();
    db.close();
  }
});

test('a host hook states the row count, metadata, and stats a vgplot data handle reports', async () => {
  const db = await nodeDuckDb();
  await db.client.exec('CREATE TABLE trips AS SELECT range::DOUBLE AS time FROM range(12)');
  const provider = createVgplotProvider({
    plots: [{ plotId: 'hours', plot: { marks: [{ type: 'rectY', sourceTable: () => 'trips' }], interactors: [] } }],
    options: {
      appId: 'test',
      viewId: 'taxi',
    },
    data: {
      duckdb: db.client,
      describe: ({ table }) => ({
        rowCount: 12,
        metadata: { source: `${table} as loaded by the dashboard` },
        stats: { loadedAt: '2026-09-30' },
      }),
    },
  });
  const runtime = createVacpRuntime({ providers: [provider] });
  try {
    const { graph, state } = await runtime.observe();
    const handle = graph.nodes.find((node) => node.kind === 'DataHandle')!;
    assert.deepEqual(handle.data, {
      table: 'trips',
      columns: [{ name: 'time', type: 'DOUBLE' }],
      metadata: { source: 'trips as loaded by the dashboard' },
    });
    assert.deepEqual(state[handle.ref], {
      kind: 'DataHandle',
      rowCount: 12,
      selectionWhere: null,
      stats: { loadedAt: '2026-09-30' },
    });
  } finally {
    runtime.dispose();
    db.close();
  }
});
