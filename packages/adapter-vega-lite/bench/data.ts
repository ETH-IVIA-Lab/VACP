import type { VacpDuckDbClient } from '@ethivia/vacp-duckdb';
import { executeVacpAction } from '@ethivia/vacp-runtime';
import { View, loader, parse } from 'vega';
import { compile, type TopLevelSpec } from 'vega-lite';
import { createVegaLiteProvider } from '../src/index';
import { measure } from '../../../tools/benchmark';

const size = 20_000;
const weathers = ['sun', 'fog', 'drizzle', 'rain', 'snow'];
const rows = Array.from({ length: size }, (_, index) => ({
  date: new Date(Date.UTC(2012, 0, 1) + index * 3_600_000).toISOString().slice(0, 10),
  weather: weathers[index % weathers.length],
  temp_max: (index % 40) - 5,
  precipitation: (index % 17) / 3,
}));
const spec: TopLevelSpec = {
  data: { url: 'data/weather.json' },
  params: [
    { name: 'minimum', value: -10, bind: { input: 'range', min: -10, max: 40 } },
    { name: 'season', select: { type: 'interval', encodings: ['x'] } },
  ],
  transform: [{ filter: 'datum.temp_max >= minimum' }],
  mark: 'point',
  encoding: {
    x: { timeUnit: 'monthdate', field: 'date', type: 'temporal' },
    y: { field: 'temp_max', type: 'quantitative' },
    color: { field: 'weather', type: 'nominal' },
  },
};

// Accepts every write and answers every query empty, so the timings are the adapter's own work.
let loads = 0;
const duckdb: VacpDuckDbClient = {
  exec: async () => {},
  queryJson: async () => ({ columns: [], rows: [] }),
  queryArrowIpcBase64: async () => '',
  loadObjectsAsTable: async () => {
    loads++;
  },
};

const files = loader();
files.load = async () => JSON.stringify(rows);
const view = new View(parse(compile(spec).spec), { renderer: 'none', loader: files });
await view.runAsync();
const provider = createVegaLiteProvider({
  view,
  spec,
  vgSpec: compile(spec).spec,
  data: { duckdb },
  options: { appId: 'benchmark', viewId: 'weather', vizId: 'chart' },
});
const { graph } = await provider.observe();
const handleRef = graph.nodes.find((node) => node.kind === 'DataHandle')!.ref;
const sql = graph.actions.find((action) => action.operation.contract === 'vacp.data_sql')!.name;
/** A SQL read that must succeed and load the shown rows `expected` times. */
const query = (expected: number) => async () => {
  const before = loads;
  const result = await executeVacpAction(provider, {
    callId: 'q',
    name: sql,
    params: { handleRef, sql: 'SELECT count(*) FROM vacp_handle' },
  });
  if (!result.ok) throw new Error(`The SQL read failed: ${JSON.stringify(result.error)}`);
  if (loads - before !== expected) throw new Error(`The SQL read loaded ${loads - before} tables, not ${expected}`);
};

let minimum = 0;
const moveFilter = async () => {
  minimum = 1 - minimum;
  view.signal('minimum', minimum);
  await view.runAsync();
};
try {
  console.log(`Node ${process.version}; native Vega view; ${size} rows with a parsed date and a time unit`);
  await measure('SQL read of an unchanged dataset', query(0), 20);
  await measure('Filter change alone, as Vega evaluates it', moveFilter, 5);
  await measure('SQL read after the filter changes the shown rows', query(1), 5, moveFilter);
} finally {
  provider.dispose?.();
  view.finalize();
}
