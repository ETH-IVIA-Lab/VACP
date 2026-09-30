import type { VacpDuckDbClient } from '@vacp/data-duckdb';
import { executeVacpAction } from '@vacp/runtime';
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
const duckdb: VacpDuckDbClient = {
  exec: async () => {},
  queryJson: async () => ({ columns: [], rows: [] }),
  queryArrowIpcBase64: async () => '',
  loadObjectsAsTable: async () => {},
};

const files = loader();
files.load = async () => JSON.stringify(rows);
const view = new View(parse(compile(spec).spec), { renderer: 'none', loader: files });
await view.runAsync();
const provider = createVegaLiteProvider({
  view,
  spec,
  options: { appId: 'benchmark', viewId: 'weather', vizId: 'chart', duckdbClient: duckdb },
});
const { graph } = await provider.observe();
const handleRef = graph.nodes.find((node) => node.kind === 'DataHandle')!.ref;
const sql = graph.actions.find((action) => action.operation.contract === 'vacp.data_sql')!.name;
const query = () =>
  executeVacpAction(provider, {
    callId: 'q',
    name: sql,
    params: { handleRef, sql: 'SELECT count(*) FROM vacp_handle' },
  });

let minimum = 0;
try {
  console.log(`Node ${process.version}; native Vega view; ${size} rows with a parsed date and a time unit`);
  await measure('SQL read of an unchanged dataset', query, 20);
  await measure(
    'Filter change alone, as Vega evaluates it',
    async () => {
      minimum = 1 - minimum;
      view.signal('minimum', minimum);
      await view.runAsync();
    },
    5,
  );
  await measure(
    'SQL read after the filter changes the shown rows',
    async () => {
      minimum = 1 - minimum;
      view.signal('minimum', minimum);
      await view.runAsync();
      await query();
    },
    5,
  );
} finally {
  provider.dispose?.();
  view.finalize();
}
