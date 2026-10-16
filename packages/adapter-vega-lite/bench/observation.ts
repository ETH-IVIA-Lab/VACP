import { View, parse } from 'vega';
import { compile, type TopLevelSpec } from 'vega-lite';
import { createVegaLiteProvider } from '../src/index';
import { measure } from '../../../tools/benchmark';

const size = 400;
const spec: TopLevelSpec = {
  params: Array.from({ length: size }, (_, index) => ({ name: `p${index}`, value: index })),
  data: {
    values: [
      { x: 1, y: 2 },
      { x: 2, y: 3 },
    ],
  },
  mark: 'point',
  encoding: { x: { field: 'x', type: 'quantitative' }, y: { field: 'y', type: 'quantitative' } },
};
const view = new View(parse(compile(spec).spec), { renderer: 'none' });
await view.runAsync();
const provider = createVegaLiteProvider({
  view,
  spec,
  vgSpec: compile(spec).spec,
  options: { appId: 'benchmark', viewId: 'signals', vizId: 'plot' },
});
try {
  console.log(`Node ${process.version}; native Vega view; ${size} parameters`);
  await measure('Vega parameter observation', () => provider.observe(), 20);
} finally {
  provider.dispose?.();
  view.finalize();
}
