import { act, defineScenario, empty, equals, mentions, sameMembers, state, unchanged } from '../src';
import { dashboard as page } from './pages';

const viz = 'vacp://vacp-examples/react/dashboard/recharts';
const scatter = `${viz}/viz/scatter/mark/scatter`;
const selection = `${viz}/viz/scatter/selection/points`;
const setosa = Array.from({ length: 50 }, (_, index) => String(index + 1));
const heavy = ['Merc 450SE', 'Cadillac Fleetwood', 'Lincoln Continental', 'Chrysler Imperial'];
const efficient = ['Fiat 128', 'Honda Civic', 'Toyota Corolla', 'Fiat X1-9', 'Porsche 914-2', 'Lotus Europa'];

export default [
  defineScenario({
    id: 'dashboard/iris-setosa',
    page,
    tags: ['setup', 'progressive'],
    source: 'synthesized',
    why: 'Encoding and selection actions appear only after a dataset loads, so the agent must act before it can see the tools it needs.',
    turns: [
      {
        say: 'Load the Iris data, plot petal length on the x axis and petal width on the y axis, colored by species, and select the setosa cluster.',
        expect: [
          state(scatter, 'datasetId', equals('iris')),
          state(scatter, 'x', equals('PetalLengthCm')),
          state(scatter, 'y', equals('PetalWidthCm')),
          state(scatter, 'color', equals('Species')),
          state(selection, 'value', sameMembers(setosa)),
        ],
        oracle: {
          steps: [
            act('dashboard.set_dataset', { id: 'iris' }),
            act('dashboard.set_encoding', { x: 'PetalLengthCm', y: 'PetalWidthCm', color: 'Species' }),
            act('dashboard.set_brush_2d', { x0: 0.9, x1: 2, y0: 0.05, y1: 0.7 }),
          ],
          answer: 'Petal length against petal width, colored by species, with the 50 setosa flowers selected.',
        },
      },
    ],
  }),
  defineScenario({
    id: 'dashboard/mtcars-heavy',
    page,
    tags: ['setup', 'select'],
    source: 'synthesized',
    why: 'Weight is in thousands of pounds, so "heavier than 4,000 lb" means wt above 4, a unit the page never states.',
    turns: [
      {
        say: 'Switch to the Motor Trend cars, put weight (wt) on the x axis and quarter-mile time (qsec) on the y axis, and select every car heavier than 4,000 lb. Which cars are they?',
        expect: [
          state(scatter, 'datasetId', equals('mtcars')),
          state(scatter, 'x', equals('wt')),
          state(scatter, 'y', equals('qsec')),
          state(selection, 'value', sameMembers(heavy)),
          ...heavy.map((car) => mentions(car)),
        ],
        oracle: {
          steps: [
            act('dashboard.set_dataset', { id: 'mtcars' }),
            act('dashboard.set_encoding', { x: 'wt', y: 'qsec', color: null }),
            act('dashboard.set_selected_ids', { ids: heavy }),
          ],
          answer: `Four cars weigh more than 4,000 lb: ${heavy.join(', ')}.`,
        },
      },
    ],
  }),
  defineScenario({
    id: 'dashboard/clear-selection-keep-chart',
    page,
    tags: ['follow-up', 'select'],
    source: 'bug-report',
    why: 'Clearing a selection must not reset the dataset or the axes the person is looking at.',
    turns: [
      {
        say: 'Show the Motor Trend cars and select the cars with more than 25 mpg.',
        expect: [state(scatter, 'datasetId', equals('mtcars')), state(selection, 'value', sameMembers(efficient))],
        oracle: {
          steps: [
            act('dashboard.set_dataset', { id: 'mtcars' }),
            act('dashboard.set_selected_ids', { ids: efficient }),
          ],
          answer: `Selected the six cars above 25 mpg: ${efficient.join(', ')}.`,
        },
      },
      {
        say: 'Clear the selection but keep the chart as it is.',
        expect: [state(selection, 'value', empty()), unchanged(scatter)],
        oracle: {
          steps: [act('dashboard.clear_selection')],
          answer: 'The selection is cleared; the chart is unchanged.',
        },
      },
    ],
  }),
];
