import { act, defineScenario, equals, mentions, readOnly, state, unchanged } from '../src';
import { cars as page } from './pages';

const base = 'vacp://vacp-examples/vanilla/cars-parallel-coords/parallel-coords';
const brushes = `${base}/selection/brushes`;
const order = `${base}/param/dimension_order`;
const hover = `${base}/selection/hover`;
const defaultOrder = ['MPG', 'Cylinders', 'Displacement', 'Horsepower', 'Weight', 'Acceleration', 'Model'];

export default [
  defineScenario({
    id: 'cars/late-eight-cylinders',
    page,
    tags: ['filter', 'strict-bound'],
    source: 'synthesized',
    why: '"More than 6 cylinders" and "after 1976" are strict bounds on discrete axes, so each brush must start above the named value.',
    turns: [
      {
        say: 'Show only cars with more than 6 cylinders built after 1976. How many are there, and what is their average MPG?',
        expect: [state(brushes, 'selectedCount', equals(25)), mentions(25), mentions(18.2, { tolerance: 0.05 })],
        oracle: {
          steps: [act('parallel_coords.set_brush_ranges', { ranges: { Cylinders: [7, 8], Model: [77, 82] } })],
          answer: '25 cars have more than 6 cylinders and a model year after 1976. Their average MPG is 18.2.',
        },
      },
    ],
    gold: [
      {
        sql: 'select count(*) as n, round(avg(MPG), 1) as mpg from {cars} where Cylinders > 6 and Model > 76',
        row: { n: 25, mpg: 18.2 },
      },
    ],
  }),
  defineScenario({
    id: 'cars/axis-order',
    page,
    tags: ['control'],
    source: 'synthesized',
    why: 'Three axes move to the front while the other four keep their relative order, which a full rewrite of the order can break.',
    turns: [
      {
        say: 'Reorder the axes so MPG comes first, then Horsepower, then Weight, keeping the other axes in their current order after them.',
        expect: [
          state(
            order,
            'value',
            equals(['MPG', 'Horsepower', 'Weight', 'Cylinders', 'Displacement', 'Acceleration', 'Model']),
          ),
        ],
        oracle: {
          steps: [
            act('parallel_coords.set_dimension_order', {
              order: ['MPG', 'Horsepower', 'Weight', 'Cylinders', 'Displacement', 'Acceleration', 'Model'],
            }),
          ],
          answer: 'The axes now read MPG, Horsepower, Weight, Cylinders, Displacement, Acceleration, Model.',
        },
      },
    ],
  }),
  defineScenario({
    id: 'cars/highlight-1976-pinto',
    page,
    tags: ['point'],
    source: 'bug-report',
    why: 'Eight rows are named Ford Pinto, so a name match picks the wrong line unless the model year narrows it.',
    turns: [
      {
        say: 'Highlight the 1976 Ford Pinto so I can see its line.',
        expect: [state(hover, 'hoveredId', equals(213)), unchanged(brushes, 'selectedCount')],
        oracle: {
          steps: [act('parallel_coords.set_hover', { id: 213 })],
          answer: 'The 1976 Ford Pinto is highlighted: 26.5 MPG, 4 cylinders, 72 horsepower.',
        },
      },
    ],
    gold: [{ sql: `select count(*) as n from {cars} where Car = 'Ford Pinto' and Model = 76`, row: { n: 1 } }],
  }),
  defineScenario({
    id: 'cars/best-japanese-mpg',
    page,
    tags: ['question', 'read-only'],
    source: 'synthesized',
    why: 'Origin and year combine, and the answer is a single car the chart does not label.',
    turns: [
      {
        say: 'Which Japanese car from 1980 or later has the best MPG? Just tell me, without changing the chart.',
        expect: [mentions('Mazda GLC'), mentions(46.6, { tolerance: 0.05 }), readOnly()],
        oracle: { answer: 'The Mazda GLC (1980) leads with 46.6 MPG.' },
      },
    ],
    gold: [
      {
        sql: `select arg_max(Car, MPG) as car, max(MPG) as mpg from {cars} where Origin = 'Japan' and Model >= 80`,
        row: { car: 'Mazda GLC', mpg: 46.6 },
      },
    ],
  }),
  defineScenario({
    id: 'cars/filter-then-restore',
    page,
    tags: ['follow-up', 'reset'],
    source: 'synthesized',
    why: 'Restoring the page means clearing brushes, the axis order, and the hover, whichever of them the first request touched.',
    turns: [
      {
        say: 'Keep only cars with at least 25 MPG and more than 100 horsepower, and put Horsepower first.',
        expect: [state(brushes, 'selectedCount', equals(9)), state(order, 'value.0', equals('Horsepower'))],
        oracle: {
          steps: [
            act('parallel_coords.set_brush_ranges', { ranges: { MPG: [25, 46.6], Horsepower: [101, 230] } }),
            act('parallel_coords.set_dimension_order', {
              order: ['Horsepower', 'MPG', 'Cylinders', 'Displacement', 'Weight', 'Acceleration', 'Model'],
            }),
          ],
          answer: '9 cars remain, with Horsepower as the first axis.',
        },
      },
      {
        say: 'Put the chart back the way it was when the page loaded.',
        expect: [
          state(brushes, 'selectedCount', equals(406)),
          state(order, 'value', equals(defaultOrder)),
          state(hover, 'hoveredId', equals(null)),
        ],
        oracle: {
          steps: [act('parallel_coords.reset_brushes'), act('parallel_coords.reset_dimension_order')],
          answer: 'The brushes and axis order are back to their defaults, with all 406 cars shown.',
        },
      },
    ],
    gold: [{ sql: 'select count(*) as n from {cars} where MPG >= 25 and Horsepower > 100', row: { n: 9 } }],
  }),
];
