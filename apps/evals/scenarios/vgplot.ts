import {
  act,
  defineScenario,
  empty,
  equals,
  mentions,
  range,
  readOnly,
  restored,
  state,
  unchanged,
  within,
} from '../src';
import { aeromagnetic, flights } from './pages';

const survey = 'vacp://vacp-examples/vgplot/aeromagnetic-survey';
const interpolation = `${survey}/input/0`;
const blur = `${survey}/input/1`;
const crossfilter = 'vacp://vacp-examples/vgplot/flights-200k';
const delay = `${crossfilter}/plot-0/interactor/0`;
const departure = `${crossfilter}/plot-1/interactor/0`;
const distance = `${crossfilter}/plot-2/interactor/0`;
const brush = (plotId: string, min: number, max: number) =>
  act('vgplot.set_interval_1d', { ref: `${crossfilter}/${plotId}/interactor/0`, min, max });

export default [
  defineScenario({
    id: 'aeromagnetic/nearest-blur',
    page: aeromagnetic,
    tags: ['control'],
    source: 'bug-report',
    why: 'Two inputs change in one request, and the range question is about the data, not about anything the controls show.',
    turns: [
      {
        say: 'Change the interpolation method to nearest neighbor and set the blur to 3. What range of magnetic readings does the survey cover?',
        expect: [
          state(interpolation, 'selectionValue', equals('nearest')),
          state(blur, 'selectionValue', equals(3)),
          mentions(-161),
          mentions(414),
        ],
        oracle: {
          steps: [
            act('vgplot.set_input_value', { ref: interpolation, value: 'nearest' }),
            act('vgplot.set_input_value', { ref: blur, value: 3 }),
          ],
          answer: 'Nearest-neighbor interpolation with a blur of 3. The readings run from -161 to 414.',
        },
      },
    ],
    gold: [
      {
        sql: 'select min(MAG_IGRF90) as lowest, max(MAG_IGRF90) as highest from {survey}',
        row: { lowest: -161, highest: 414 },
      },
    ],
  }),
  defineScenario({
    id: 'aeromagnetic/undo-inputs',
    page: aeromagnetic,
    tags: ['follow-up', 'reset'],
    source: 'synthesized',
    why: '"Undo" names no values, so the agent must know or find the defaults the page started with.',
    turns: [
      {
        say: 'Use barycentric interpolation with a blur of 10.',
        expect: [
          state(interpolation, 'selectionValue', equals('barycentric')),
          state(blur, 'selectionValue', equals(10)),
        ],
        oracle: {
          steps: [
            act('vgplot.set_input_value', { ref: interpolation, value: 'barycentric' }),
            act('vgplot.set_input_value', { ref: blur, value: 10 }),
          ],
          answer: 'Barycentric interpolation with a blur of 10.',
        },
      },
      {
        say: 'Undo both of those changes.',
        expect: [restored(interpolation, 'selectionValue'), restored(blur, 'selectionValue')],
        oracle: {
          steps: [
            act('vgplot.set_input_value', { ref: interpolation, value: 'random-walk' }),
            act('vgplot.set_input_value', { ref: blur, value: 0 }),
          ],
          answer: 'Back to random-walk interpolation with no blur.',
        },
      },
    ],
  }),
  defineScenario({
    id: 'flights/late-evening',
    page: flights,
    tags: ['filter', 'bins'],
    source: 'bug-report',
    why: 'Delay is binned by 10 minutes, so no brush matches "more than an hour" exactly; the true count needs a query.',
    turns: [
      {
        say: 'Show only flights delayed by more than an hour that departed at or after 6 pm. How many flights is that?',
        expect: [
          state(delay, 'selectionValue.0', within(60, 70)),
          state(delay, 'selectionValue.1', within(170, 200)),
          state(departure, 'selectionValue.0', within(17.9, 18.5)),
          state(departure, 'selectionValue.1', within(23.5, 24.5)),
          mentions(5606),
        ],
        oracle: {
          steps: [brush('plot-0', 60.5, 190), brush('plot-1', 18, 24)],
          answer: '5,606 flights were delayed by more than an hour and departed at or after 6 pm.',
        },
      },
    ],
    gold: [
      { sql: 'select count(*) as flights from {flights} where delay > 60 and time >= 18', row: { flights: 5606 } },
    ],
  }),
  defineScenario({
    id: 'flights/long-haul-share',
    page: flights,
    tags: ['question', 'read-only'],
    source: 'synthesized',
    why: 'The distance histogram shows counts per bin, not a share above a threshold.',
    turns: [
      {
        say: 'What share of flights flew more than 1,500 miles? Please leave the charts as they are.',
        expect: [mentions(2.9, { tolerance: 0.1 }), readOnly()],
        oracle: { answer: 'About 2.9% of the 231,083 flights flew more than 1,500 miles.' },
      },
    ],
    gold: [{ sql: 'select round(100 * avg((distance > 1500)::INT), 1) as pct from {flights}', row: { pct: 2.9 } }],
  }),
  defineScenario({
    id: 'flights/remove-one-filter',
    page: flights,
    tags: ['follow-up', 'targeted'],
    source: 'synthesized',
    why: 'Two brushes share one crossfilter, and only one of them may go.',
    setup: [brush('plot-0', 60, 180), brush('plot-2', 1000, 2300)],
    turns: [
      {
        say: 'Remove the distance filter but keep the delay filter.',
        expect: [
          state(distance, 'selectionValue', empty()),
          state(delay, 'selectionValue', range([60, 180])),
          unchanged(delay, 'selectionValue'),
        ],
        oracle: {
          steps: [act('vgplot.clear_interval_1d', { ref: distance })],
          answer: 'The distance filter is gone; the delay filter stays at 60 to 180 minutes.',
        },
      },
    ],
  }),
];
