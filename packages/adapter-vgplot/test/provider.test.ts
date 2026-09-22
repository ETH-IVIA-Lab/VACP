import assert from 'node:assert/strict';
import test from 'node:test';
import { createVacpRuntime } from '@vacp/runtime';
import { createVgplotProvider, type VgplotInteractorLike, type VgplotPlotLike } from '../src/index';

test('table actions preserve default targets when parameters are omitted', async () => {
  const table = { sortColumn: 'x', sortDesc: true, update: () => undefined };
  const provider = createVgplotProvider({
    plots: [],
    tables: [{ tableId: 'table', table }],
    options: { appId: 'test', viewId: 'table', enableSql: false },
  });
  const runtime = createVacpRuntime({ providers: [provider] });
  try {
    const graph = (await runtime.getCapabilities()).graph;
    const action = graph.actions.find((action) => action.operation.contract === 'vgplot.table_clear_sort')!;
    assert.equal((await runtime.execute({ callId: 'clear', name: action.name })).ok, true);
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
    update(value: unknown) {
      this.value = Number(value);
    },
  };
  const original = selection.update;
  const init = () => {};
  const interactor: VgplotInteractorLike = { constructor: { name: 'Toggle' }, selection, init };
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
  const selection = { update() {} };
  const original = selection.update;
  const interactor: VgplotInteractorLike = { constructor: { name: 'Toggle' }, selection };
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
  const pan: VgplotInteractorLike = {
    constructor: { name: 'PanZoom' },
    xscale: { domain: [0, 20], apply: (value) => Number(value) },
    yscale: { domain: () => [0, 20], apply: (value) => Number(value) },
    xsel: { update: (value) => axes.push(value) },
    ysel: { update: (value) => axes.push(value) },
    clause: (value) => value,
  };
  const provider = createVgplotProvider({
    plots: [{ plotId: 'plot', plot: { marks: [], interactors: [pan] } }],
    tables: [{ tableId: 'table', table }],
    options: { appId: 'test', viewId: 'prepared', enableSql: false },
  });
  try {
    const { graph } = await provider.observe();
    const call = (contract: string, params: unknown) => ({
      callId: contract,
      name: graph.actions.find((action) => action.operation.contract === contract)!.name,
      params,
    });
    await assert.rejects(
      provider.prepare(call('vgplot.table_set_sort', { column: 'missing' })),
      /Unknown table column/,
    );
    await assert.rejects(provider.prepare(call('vgplot.table_set_page', { offset: 20, limit: 'invalid' })), /finite/);
    await assert.rejects(
      provider.prepare(call('vgplot.set_pan_zoom', { interactorId: 0, x0: 0, x1: 10, y0: 0, y1: 'bad' })),
      /numeric y0/,
    );
    assert.equal(table.offset, 0);
    assert.equal(table.limit, 10);
    assert.deepEqual(axes, []);
    const zoom = await provider.prepare(call('vgplot.set_pan_zoom', { interactorId: 0, x0: 0, x1: 10, y0: 0, y1: 10 }));
    assert.deepEqual(zoom.intent.focus?.interaction, { kind: 'zoom', direction: 'in' });
    const panning = await provider.prepare(call('vgplot.set_pan_zoom', { interactorId: 0, x0: 10, x1: 30 }));
    assert.deepEqual(panning.intent.focus?.interaction, { kind: 'pan' });
    pan.ysel = { update: (value) => axes.push(value) };
    assert.equal((await zoom.execute()).ok, false);
    assert.deepEqual(axes, []);
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
    interactors: [{ constructor: { name: 'Toggle' }, selection }],
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
  assert.equal(plot.interactors[0]!.init, undefined);
  const wrappedUpdate = selection.update;
  second.subscribe!(() => {
    changes++;
  });
  assert.equal(selection.update, wrappedUpdate);
  first.dispose!();
  assert.notEqual(selection.update, originalUpdate);
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
  const interactor: VgplotInteractorLike = {
    constructor: { name: 'Toggle' },
    selection: {
      update: () => {
        writes++;
      },
    },
    clause: (value) => value,
  };
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
      params: { interactorId: 0, value: 'x' },
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
  const interactor: VgplotInteractorLike = {
    constructor: { name: 'Toggle' },
    selection: { update: () => {} },
    init() {
      this.selection = readonlySelection;
      return result;
    },
  };
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
  const pan: VgplotInteractorLike = {
    constructor: { name: 'PanZoom' },
    xscale: cached,
    svg: { scale: () => ({ domain, apply: Number }) },
    xsel: {
      update: (value) => {
        domain = value as number[];
      },
    },
    clause: (value) => value,
  };
  const provider = createVgplotProvider({
    plots: [{ plotId: 'plot', plot: { marks: [], interactors: [pan] } }],
    options: { appId: 'test', viewId: 'live-domain', enableSql: false },
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
        params: { interactorId: 0, x0, x1 },
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
  const interactor: VgplotInteractorLike = {
    constructor: { name: 'Interval1D' },
    channel: 'y',
    scale: { domain: [0, 100], apply: (value) => 100 - Number(value) },
    selection: { update: (value) => writes.push(value) },
    clause: (value) => value,
    brush: { moveSilent() {} },
    g: { call: (_, value) => brushes.push(value) },
  };
  const provider = createVgplotProvider({
    plots: [{ plotId: 'plot', plot: { marks: [], interactors: [interactor] } }],
    options: { appId: 'test', viewId: 'interval', enableSql: false },
  });
  try {
    const { graph } = await provider.observe();
    const action = graph.actions.find((action) => action.operation.contract === 'vgplot.set_interval_1d')!;
    const call = { callId: 'range', name: action.name, params: { interactorId: '0', min: 60, max: 20 } };
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
