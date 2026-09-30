import assert from 'node:assert/strict';
import test from 'node:test';
import { View, parse } from 'vega';
import { compile, type TopLevelSpec } from 'vega-lite';
import { createVegaLiteProvider } from '../src/index';

const athletes = [
  { weight: 60, height: 1.7 },
  { weight: 72, height: 1.91 },
  { weight: 84, height: 1.94 },
  { weight: 90, height: 1.85 },
];

async function brushFixture() {
  const spec: TopLevelSpec = {
    data: { values: structuredClone(athletes) },
    vconcat: [
      {
        params: [{ name: 'body', select: { type: 'interval', encodings: ['x', 'y'] } }],
        mark: 'point',
        encoding: {
          x: { field: 'weight', type: 'quantitative' },
          y: { field: 'height', type: 'quantitative', scale: { zero: false } },
        },
      },
      {
        name: 'selected',
        transform: [{ filter: { param: 'body' } }],
        mark: 'point',
        encoding: { x: { field: 'weight', type: 'quantitative' }, y: { field: 'height', type: 'quantitative' } },
      },
    ],
  };
  const compiled = compile(spec).spec;
  const filtered = compiled.data?.find(
    (dataset) =>
      'transform' in dataset &&
      dataset.transform?.some(
        (transform) => transform.type === 'filter' && String(transform.expr).includes('body_store'),
      ),
  );
  assert.ok(filtered);
  const view = new View(parse(compiled), { renderer: 'none' });
  await view.runAsync();
  const provider = createVegaLiteProvider({
    view,
    spec,
    options: { appId: 'test', viewId: 'physique', vizId: 'body', enableDuckDbDataHandle: false },
  });
  const select = async (value: unknown) => {
    const descriptor = (await provider.observe()).graph.actions.find(
      (action) => action.operation.contract === 'vega_lite.set_selection',
    );
    assert.ok(descriptor);
    const prepared = await provider.prepare({
      callId: 'select',
      name: descriptor.name,
      params: { ref: 'vacp://test/physique/body/param/body', value },
    });
    return prepared.execute();
  };
  return {
    view,
    select,
    heights: () => view.data(filtered.name).map((row: { height: number }) => row.height),
    dispose: () => {
      provider.dispose?.();
      view.finalize();
    },
  };
}

test('an interval given for one channel of a two-channel brush spans the other channel’s axis', async () => {
  const f = await brushFixture();
  try {
    const result = await f.select({ y: [1.9, 2.25] });
    assert.equal(result.ok, true);
    const value = f.view.signal('body') as { weight?: number[]; height?: number[] };
    assert.deepEqual(value.height, [1.9, 2.25]);
    assert.deepEqual(value.weight, f.view.scale('concat_0_x').domain());
    assert.deepEqual(f.heights().sort(), [1.91, 1.94]);
  } finally {
    f.dispose();
  }
});

test('a range that is not two numbers is rejected before the brush changes', async () => {
  const f = await brushFixture();
  try {
    assert.equal((await f.select({ y: [1.9, 2.25] })).ok, true);
    await assert.rejects(f.select({ y: ['tall', 'taller'] }), /y \(height\) as \[min, max\] numbers/);
    assert.deepEqual((f.view.signal('body') as { height?: number[] }).height, [1.9, 2.25]);
    assert.deepEqual(f.heights().sort(), [1.91, 1.94]);
  } finally {
    f.dispose();
  }
});

test('a range outside the axis domain is rejected with the domain, before the brush changes', async () => {
  const f = await brushFixture();
  try {
    assert.equal((await f.select({ y: [1.9, 2.25] })).ok, true);
    await assert.rejects(
      f.select({ y: [3, 4] }),
      /y \(height\) spans 1\.\d+ to 1\.\d+, so 3 to 4 would select nothing/,
    );
    assert.deepEqual((f.view.signal('body') as { height?: number[] }).height, [1.9, 2.25]);
    assert.deepEqual(f.heights().sort(), [1.91, 1.94]);
  } finally {
    f.dispose();
  }
});

const days = ['2013-05-31', '2013-06-01', '2013-07-15', '2013-08-31', '2013-09-01', '2014-06-10', '2014-12-24'];
// Local midnight, the clock the month-and-day time unit reads, so the fixture holds in every time zone.
const localMidnight = (day: string) => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year!, month! - 1, date).valueOf();
};
const localDay = (time: number) => {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/** Days across two years, brushed on a month-and-day axis that folds every year onto one. */
async function seasonFixture() {
  const spec: TopLevelSpec = {
    data: { values: days.map((day) => ({ date: localMidnight(day) })) },
    vconcat: [
      {
        params: [{ name: 'season', select: { type: 'interval', encodings: ['x'] } }],
        mark: 'point',
        encoding: { x: { timeUnit: 'monthdate', field: 'date', type: 'temporal' } },
      },
      {
        name: 'selected',
        transform: [{ filter: { param: 'season' } }],
        mark: 'point',
        encoding: { x: { field: 'date', type: 'temporal' } },
      },
    ],
  };
  const compiled = compile(spec).spec;
  const filtered = compiled.data?.find(
    (dataset) =>
      'transform' in dataset &&
      dataset.transform?.some(
        (transform) => transform.type === 'filter' && String(transform.expr).includes('season_store'),
      ),
  );
  assert.ok(filtered);
  const view = new View(parse(compiled), { renderer: 'none' });
  await view.runAsync();
  const provider = createVegaLiteProvider({
    view,
    spec,
    options: { appId: 'test', viewId: 'weather', vizId: 'season', enableDuckDbDataHandle: false },
  });
  const select = async (value: unknown) => {
    const descriptor = (await provider.observe()).graph.actions.find(
      (action) => action.operation.contract === 'vega_lite.set_selection',
    );
    assert.ok(descriptor);
    const prepared = await provider.prepare({
      callId: 'select',
      name: descriptor.name,
      params: { ref: 'vacp://test/weather/season/param/season', value },
    });
    return prepared.execute();
  };
  return {
    select,
    days: () =>
      view
        .data(filtered.name)
        .map((row: { date: number }) => localDay(row.date))
        .sort(),
    dispose: () => {
      provider.dispose?.();
      view.finalize();
    },
  };
}

test('a month-and-day brush takes ISO dates on the axis year and selects those days in every year', async () => {
  const f = await seasonFixture();
  try {
    const result = await f.select({ x: ['2012-06-01', '2012-08-31'] });
    assert.equal(result.ok, true);
    assert.deepEqual(f.days(), ['2013-06-01', '2013-07-15', '2013-08-31', '2014-06-10']);
  } finally {
    f.dispose();
  }
});

test('a month-and-day brush given dates from another year is rejected with the axis span', async () => {
  const f = await seasonFixture();
  try {
    await assert.rejects(
      f.select({ x: ['2014-06-01', '2014-08-31'] }),
      /x \(monthdate_date\) spans 2012-05-31 to 2012-12-24, so 2014-06-01 to 2014-08-31 would select nothing/,
    );
    // An empty interval selection filters nothing.
    assert.deepEqual(f.days(), days);
  } finally {
    f.dispose();
  }
});

async function selection(spec: TopLevelSpec, param: string) {
  const compiled = compile(spec).spec;
  const view = new View(parse(compiled), { renderer: 'none' });
  await view.runAsync();
  const provider = createVegaLiteProvider({
    view,
    spec,
    options: { appId: 'test', viewId: 'view', vizId: 'chart', enableDuckDbDataHandle: false },
  });
  const select = async (value: unknown) => {
    const descriptor = (await provider.observe()).graph.actions.find(
      (action) => action.operation.contract === 'vega_lite.set_selection',
    );
    const prepared = await provider.prepare({
      callId: 'select',
      name: descriptor!.name,
      params: { ref: `vacp://test/view/chart/param/${param}`, value },
    });
    return prepared.execute();
  };
  return {
    view,
    select,
    /** The rows of the dataset that filters by this selection. */
    filtered: () =>
      view.data(
        compiled.data!.find(
          (dataset) =>
            'transform' in dataset &&
            dataset.transform?.some(
              (transform) => transform.type === 'filter' && String(transform.expr).includes(`${param}_store`),
            ),
        )!.name,
      ),
    dispose: () => {
      provider.dispose?.();
      view.finalize();
    },
  };
}

test('a scale-bound interval pans to a range outside the current view', async () => {
  const f = await selection(
    {
      data: { values: structuredClone(athletes) },
      params: [{ name: 'viewport', select: { type: 'interval', encodings: ['x'] }, bind: 'scales' }],
      mark: 'point',
      encoding: { x: { field: 'weight', type: 'quantitative' }, y: { field: 'height', type: 'quantitative' } },
    },
    'viewport',
  );
  try {
    assert.equal((await f.select({ x: [200, 300] })).ok, true);
    assert.deepEqual(f.view.scale('x').domain(), [200, 300]);
  } finally {
    f.dispose();
  }
});

test('a native tuple is held to the axis domain like a keyed range', async () => {
  const f = await brushFixture();
  try {
    await assert.rejects(
      f.select({ fields: [{ field: 'height', channel: 'y', type: 'R' }], values: [[3, 4]] }),
      /y \(height\) spans .+ so 3 to 4 would select nothing/,
    );
  } finally {
    f.dispose();
  }
});

test('a point selection on a temporal field takes an ISO date on the axis clock', async () => {
  const f = await selection(
    {
      data: { values: days.map((day) => ({ date: localMidnight(day) })) },
      vconcat: [
        {
          params: [{ name: 'day', select: { type: 'point', fields: ['date'] } }],
          mark: 'point',
          encoding: { x: { field: 'date', type: 'temporal' } },
        },
        {
          transform: [{ filter: { param: 'day' } }],
          mark: 'point',
          encoding: { x: { field: 'date', type: 'temporal' } },
        },
      ],
    },
    'day',
  );
  try {
    assert.equal((await f.select({ date: '2013-07-15' })).ok, true);
    assert.deepEqual(
      f.filtered().map((row: { date: number }) => localDay(row.date)),
      ['2013-07-15'],
    );
    await assert.rejects(f.select({ date: 'mid July' }), /ISO date/);
  } finally {
    f.dispose();
  }
});
