import {
  act,
  containsAll,
  defineScenario,
  empty,
  equals,
  mentions,
  range,
  readOnly,
  sameMembers,
  state,
  unchanged,
  view,
} from '../src';
import { declines } from './phrases';
import { athletes as page } from './pages';

const cohort = 'vacp://vacp-examples/athletes/cohort';
const body = 'vacp://vacp-examples/athletes/physique/param/body';
const age = (min: number, max: number) =>
  act('vgplot.set_interval_1d', { plotId: 'age', interactorId: '0', min, max }, `Keeping ages ${min} to ${max}.`);
const ageSql = `2016 - year(date_of_birth::DATE) - (strftime(date_of_birth::DATE, '%m-%d') > '08-05')::INT`;

export default [
  defineScenario({
    id: 'athletes/female-tall-young',
    page,
    tags: ['filter', 'multi-control', 'strict-bound'],
    source: 'bug-report',
    why: 'Four controls across three providers must combine, and "taller than 180 cm" excludes athletes at exactly 1.80 m, which an inclusive brush keeps.',
    turns: [
      {
        say: 'Show female gymnasts and swimmers (aquatics) aged 18 to 25 who are taller than 180 cm. How many are there, and who is the tallest?',
        expect: [
          state(cohort, 'sex', equals('female')),
          state(cohort, 'sports', sameMembers(['aquatics', 'gymnastics'])),
          state(cohort, 'age', range([18, 25])),
          state(cohort, 'count', equals(39)),
          mentions(39),
          mentions('Cierra Runge'),
        ],
        oracle: {
          steps: [
            act('cohort.set_sex', { sex: 'female' }),
            act('cohort.set_sports', { sports: ['aquatics', 'gymnastics'] }),
            age(18, 25),
            act('vega_lite.set_selection', { ref: body, value: { y: [1.805, 2.25] } }),
          ],
          answer: '39 athletes match. The tallest is Cierra Runge at 1.94 m.',
        },
      },
    ],
    gold: [
      {
        sql: `select count(*) as n, arg_max(name, height) as tallest from {athletes} where sex = 'female' and sport in ('aquatics', 'gymnastics') and ${ageSql} between 18 and 25 and height > 1.80 and weight is not null`,
        row: { n: 39, tallest: 'Cierra Runge' },
      },
    ],
  }),
  defineScenario({
    id: 'athletes/male-top-medal-share',
    page,
    tags: ['select', 'ranking'],
    source: 'synthesized',
    why: 'The share must be computed within male athletes, not read from the all-athlete ranking, and rowing sits less than a point behind.',
    turns: [
      {
        say: 'Among male athletes, which sport has the highest medalist share? Show only that sport, and tell me the share and how many athletes it covers.',
        expect: [
          state(cohort, 'sex', equals('male')),
          state(cohort, 'sports', sameMembers(['gymnastics'])),
          state(cohort, 'count', equals(114)),
          mentions('gymnastics'),
          mentions(26.3, { tolerance: 0.1 }),
          mentions(114),
        ],
        oracle: {
          steps: [act('cohort.set_sex', { sex: 'male' }), act('cohort.set_sports', { sports: ['gymnastics'] })],
          answer: 'Gymnastics: 30 of its 114 male athletes won a medal, a 26.3% share.',
        },
      },
    ],
    gold: [
      {
        sql: `select sport, round(100 * avg(((gold + silver + bronze) > 0)::INT), 1) as pct, count(*) as n from {athletes} where sex = 'male' group by sport order by avg(((gold + silver + bronze) > 0)::INT) desc limit 1`,
        row: { sport: 'gymnastics', pct: 26.3, n: 114 },
      },
    ],
  }),
  defineScenario({
    id: 'athletes/heavy-median-age',
    page,
    tags: ['filter', 'open-range'],
    source: 'synthesized',
    why: 'The brush must span every height while fixing weight, and the median comes from the cohort, not the whole dataset.',
    turns: [
      {
        say: 'In the height and weight chart, select athletes who weigh between 100 and 150 kg, whatever their height. What is their median age?',
        expect: [
          state(body, 'value.weight', range([100, 150], 0.5)),
          state(cohort, 'count', equals(624)),
          mentions(27),
        ],
        oracle: {
          steps: [act('vega_lite.set_selection', { ref: body, value: { x: [100, 150] } })],
          answer: 'The 624 athletes weighing 100 to 150 kg have a median age of 27.',
        },
      },
    ],
    gold: [
      {
        sql: `select count(*) as n, median(${ageSql}) as median_age from {athletes} where weight between 100 and 150 and height is not null`,
        row: { n: 624, median_age: 27 },
      },
    ],
  }),
  defineScenario({
    id: 'athletes/age-narrowing',
    page,
    tags: ['filter', 'sequence'],
    source: 'synthesized',
    why: 'Two counts are needed from two states of the same brush, so the agent must read between its own steps.',
    turns: [
      {
        say: 'Brush ages 30 to 40, then narrow the brush to 30 to 35. How many athletes are in the cohort before and after?',
        expect: [
          state(cohort, 'age', range([30, 35])),
          state(cohort, 'count', equals(2127)),
          mentions(2521),
          mentions(2127),
        ],
        oracle: {
          steps: [age(30, 40), age(30, 35)],
          answer: 'Ages 30 to 40 hold 2,521 athletes; narrowing to 30 to 35 leaves 2,127.',
        },
      },
    ],
    gold: [
      {
        sql: `select count(*) filter (where ${ageSql} between 30 and 40) as wide, count(*) filter (where ${ageSql} between 30 and 35) as narrow from {athletes}`,
        row: { wide: 2521, narrow: 2127 },
      },
    ],
  }),
  defineScenario({
    id: 'athletes/point-at-simone-biles',
    page,
    tags: ['point'],
    source: 'bug-report',
    why: 'The chart has 11,538 marks and the page offers no search. Pointing at one athlete must not filter the dashboard, which a brush around her would do.',
    turns: [
      {
        say: 'Point out Simone Biles in the height and weight chart so I can see where she sits.',
        expect: [
          view('#vg-tooltip-element', containsAll('Simone Biles')),
          unchanged(cohort, 'count'),
          unchanged(body, 'value'),
        ],
        oracle: {
          steps: [act('vega_lite.hover_tooltip', { fields: { name: 'Simone Biles' } })],
          answer: 'Simone Biles is the dot at 47 kg and 1.45 m, in the short, light corner of the chart.',
        },
      },
    ],
  }),
  defineScenario({
    id: 'athletes/kenya-medalists',
    page,
    tags: ['question', 'read-only'],
    source: 'synthesized',
    why: 'Nationality has no control on the page, so the answer must come from a data query, and the view must stay as it is.',
    turns: [
      {
        say: 'How many Kenyan athletes won a medal at Rio 2016? Please leave the view as it is.',
        expect: [mentions(12), readOnly(), unchanged(cohort)],
        oracle: { answer: '12 of the 80 Kenyan athletes won a medal.' },
      },
    ],
    gold: [
      {
        sql: `select count(*) filter (where gold + silver + bronze > 0) as medalists, count(*) as athletes from {athletes} where nationality = 'KEN'`,
        row: { medalists: 12, athletes: 80 },
      },
    ],
  }),
  defineScenario({
    id: 'athletes/brazil-filter',
    page,
    tags: ['decline'],
    source: 'bug-report',
    why: 'The page cannot filter by nationality. An agent that improvises a brush or claims success misleads the person.',
    turns: [
      {
        say: 'Filter the dashboard to athletes from Brazil only.',
        expect: [declines(), unchanged(cohort), unchanged(body, 'value')],
        oracle: {
          answer: "This dashboard can't filter by nationality: its controls are sport, sex, age, and body size.",
        },
      },
    ],
  }),
  defineScenario({
    id: 'athletes/compare-median-ages',
    page,
    tags: ['question', 'compare'],
    source: 'synthesized',
    why: 'Two cohorts must be read one after the other, and the view must end on the second one.',
    turns: [
      {
        say: 'Compare the median age of male swimmers (aquatics) and male equestrian riders, and leave the equestrian riders on screen.',
        expect: [
          state(cohort, 'sex', equals('male')),
          state(cohort, 'sports', sameMembers(['equestrian'])),
          state(cohort, 'medianAge', equals(37)),
          mentions(24),
          mentions(37),
        ],
        oracle: {
          steps: [act('cohort.set_sex', { sex: 'male' }), act('cohort.set_sports', { sports: ['equestrian'] })],
          answer: 'Male swimmers have a median age of 24; male equestrian riders, 37.',
        },
      },
    ],
    gold: [
      {
        sql: `select median(${ageSql}) filter (where sport = 'aquatics') as aquatics, median(${ageSql}) filter (where sport = 'equestrian') as equestrian from {athletes} where sex = 'male'`,
        row: { aquatics: 24, equestrian: 37 },
      },
    ],
  }),
  defineScenario({
    id: 'athletes/filter-then-reset',
    page,
    tags: ['follow-up', 'reset'],
    source: 'synthesized',
    why: 'Resetting must clear every provider, including the cohort controls the second request does not name.',
    turns: [
      {
        say: 'Show only female rowers.',
        expect: [
          state(cohort, 'sex', equals('female')),
          state(cohort, 'sports', sameMembers(['rowing'])),
          state(cohort, 'count', equals(216)),
        ],
        oracle: {
          steps: [act('cohort.set_sex', { sex: 'female' }), act('cohort.set_sports', { sports: ['rowing'] })],
          answer: 'Showing the 216 female rowers.',
        },
      },
      {
        say: 'Now clear every filter so all athletes show again.',
        expect: [
          state(cohort, 'count', equals(11538)),
          state(cohort, 'sex', equals('all')),
          state(cohort, 'sports', empty()),
          state(cohort, 'age', empty()),
          state(cohort, 'body', empty()),
        ],
        oracle: {
          steps: [act('cohort.set_sex', { sex: 'all' }), act('cohort.set_sports', { sports: [] })],
          answer: 'All 11,538 athletes are back in view.',
        },
      },
    ],
    gold: [{ sql: `select count(*) as n from {athletes} where sex = 'female' and sport = 'rowing'`, row: { n: 216 } }],
  }),
];
