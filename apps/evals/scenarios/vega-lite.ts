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
import { airports, development, weather } from './pages';

const airportsView = 'vacp://vacp-examples/vega-lite/airports/airports';
const origin = `${airportsView}/param/org`;
const weatherView = 'vacp://vacp-examples/vega-lite/seattle-weather/seattle-weather';
const brush = `${weatherView}/param/brush`;
const click = `${weatherView}/param/click`;
const year = 'vacp://vacp-examples/vega-lite/global-development/global-development/param/current_year';
const day = 86_400_000;
// Vega-Lite places month-and-day time units in the leap year 2012.
const summer: [number, number] = [Date.UTC(2012, 5, 1), Date.UTC(2012, 7, 31, 12)];

export default [
  defineScenario({
    id: 'airports/seattle-routes',
    page: airports,
    tags: ['select'],
    source: 'bug-report',
    why: 'Routes appear only once an origin is selected, and the count is of destinations, which the map draws but never labels.',
    turns: [
      {
        say: 'Show the flight routes out of Seattle. How many routes does it have?',
        expect: [state(origin, 'value.origin', sameMembers(['SEA'])), mentions(56)],
        oracle: {
          steps: [act('vega_lite.set_selection', { ref: origin, value: { origin: 'SEA' } })],
          answer: 'Seattle (SEA) has 56 routes.',
        },
      },
    ],
    gold: [{ sql: `select count(*) as routes from {flights} where origin = 'SEA'`, row: { routes: 56 } }],
  }),
  defineScenario({
    id: 'airports/point-at-busiest',
    page: airports,
    tags: ['point'],
    source: 'bug-report',
    why: 'Once routes are drawn, the origin code matches many route marks as well as the airport, so pointing needs a field only the airport has.',
    turns: [
      {
        say: 'Which airport has the most routes? Point at it on the map.',
        expect: [mentions(['ATL', 'Atlanta']), view('#vg-tooltip-element', containsAll('Atlanta'))],
        oracle: {
          steps: [act('vega_lite.hover_tooltip', { fields: { origin: 'ATL', airport_state: 'GA' } })],
          answer: 'Atlanta (ATL) has the most routes, 173. It is highlighted on the map.',
        },
      },
    ],
    gold: [
      {
        sql: 'select arg_max(origin, n) as origin, max(n) as routes from (select origin, count(*) as n from {flights} group by origin)',
        row: { origin: 'ATL', routes: 173 },
      },
    ],
  }),
  defineScenario({
    id: 'airports/denver-top-destination',
    page: airports,
    tags: ['question', 'read-only'],
    source: 'synthesized',
    why: 'The answer is a flight count per route, which the map shows only as line width.',
    turns: [
      {
        say: 'From Denver (DEN), which destination has the most flights? Please leave the map as it is.',
        expect: [mentions(['SLC', 'Salt Lake']), readOnly(), unchanged(origin, 'value')],
        oracle: { answer: 'Salt Lake City (SLC), with 8,905 flights from Denver.' },
      },
    ],
    gold: [
      {
        sql: `select arg_max(destination, count) as destination, max(count) as flights from {flights} where origin = 'DEN'`,
        row: { destination: 'SLC', flights: 8905 },
      },
    ],
  }),
  defineScenario({
    id: 'airports/clear-origin',
    page: airports,
    tags: ['follow-up', 'reset'],
    source: 'synthesized',
    why: 'The selection was made before the conversation began, so the agent has to discover it before it can clear it.',
    setup: [act('vega_lite.set_selection', { ref: origin, value: { origin: 'SEA' } })],
    turns: [
      {
        say: 'Clear the airport selection so the map shows no routes.',
        expect: [state(origin, 'value', empty())],
        oracle: {
          steps: [act('vega_lite.clear_selection', { ref: origin })],
          answer: 'The selection is cleared and no routes are drawn.',
        },
      },
    ],
  }),
  defineScenario({
    id: 'weather/summer-2014',
    page: weather,
    tags: ['filter', 'time'],
    source: 'bug-report',
    why: 'The brush works on month and day across every year, so the 2014 answer needs a query the brush alone cannot give.',
    turns: [
      {
        say: 'Brush June through August in the weather chart, then tell me which weather type was most common in the summer of 2014, and on how many days.',
        expect: [state(brush, 'value.monthdate_date', range(summer, 1.5 * day)), mentions('sun'), mentions(68)],
        oracle: {
          steps: [act('vega_lite.set_selection', { ref: brush, value: { x: summer } })],
          answer: 'In June to August 2014, sun was most common, on 68 of 92 days.',
        },
      },
    ],
    gold: [
      {
        sql: `select arg_max(weather, n) as weather, max(n) as days from (select weather, count(*) as n from {weather} where date between '2014-06-01' and '2014-08-31' group by weather)`,
        row: { weather: 'sun', days: 68 },
      },
    ],
  }),
  defineScenario({
    id: 'weather/rainiest-month',
    page: weather,
    tags: ['question', 'read-only'],
    source: 'synthesized',
    why: 'December leads February and November by one day, so an estimate from the chart is not enough.',
    turns: [
      {
        say: 'Across all years, which month has the most rainy days? Please do not change the chart.',
        expect: [mentions('December'), readOnly()],
        oracle: { answer: 'December, with 76 rainy days across the four years.' },
      },
    ],
    gold: [
      {
        sql: `select arg_max(m, n) as month, max(n) as days from (select monthname(date) as m, count(*) as n from {weather} where weather = 'rain' group by m)`,
        row: { month: 'December', days: 76 },
      },
    ],
  }),
  defineScenario({
    id: 'weather/snow-days',
    page: weather,
    tags: ['select'],
    source: 'synthesized',
    why: 'Weather types are selected through the legend, a point selection with no control of its own.',
    turns: [
      {
        say: 'Show only the snowy days. How many are there?',
        expect: [state(click, 'value.weather', sameMembers(['snow'])), mentions(26)],
        oracle: {
          steps: [act('vega_lite.set_selection', { ref: click, value: { weather: 'snow' } })],
          answer: 'There are 26 snowy days.',
        },
      },
    ],
    gold: [{ sql: `select count(*) as days from {weather} where weather = 'snow'`, row: { days: 26 } }],
  }),
  defineScenario({
    id: 'development/year-1980',
    page: development,
    tags: ['control'],
    source: 'synthesized',
    why: 'The year is a bound slider, a parameter rather than a selection, and Iceland trails Japan by less than 0.1 years.',
    turns: [
      {
        say: 'Move the chart to the year 1980 and tell me which country had the highest life expectancy then.',
        expect: [state(year, 'value', equals(1980)), mentions('Japan'), mentions(76.6, { tolerance: 0.05 })],
        oracle: {
          steps: [act('vega_lite.set_param', { ref: year, value: 1980 })],
          answer: 'In 1980 Japan had the highest life expectancy, 76.6 years.',
        },
      },
    ],
    gold: [
      {
        sql: 'select arg_max(country, life_expect) as country, round(max(life_expect), 1) as years from {gapminder} where year = 1980',
        row: { country: 'Japan', years: 76.6 },
      },
    ],
  }),
  defineScenario({
    id: 'development/year-out-of-range',
    page: development,
    tags: ['decline'],
    source: 'synthesized',
    why: 'The slider stops at 2005. The task says what to do instead, so leaving the chart alone is the only correct move.',
    turns: [
      {
        say: 'Show the chart for the year 2010. If that year is not available, leave the chart as it is and tell me the latest year it covers.',
        expect: [unchanged(year, 'value'), mentions(2005), declines()],
        oracle: {
          answer: "The chart doesn't have 2010: it covers 1955 to 2005 in five-year steps, so 2005 is the latest.",
        },
      },
    ],
    gold: [{ sql: 'select max(year) as latest from {gapminder}', row: { latest: 2005 } }],
  }),
  defineScenario({
    id: 'development/lowest-2005',
    page: development,
    tags: ['question', 'read-only'],
    source: 'synthesized',
    why: 'The answer sits at the edge of a crowded scatter, and the chart shows 1990 when the page loads.',
    turns: [
      {
        say: 'Which country had the lowest life expectancy in 2005? Please leave the chart as it is.',
        expect: [mentions('South Africa'), readOnly(), unchanged(year, 'value')],
        oracle: { answer: 'South Africa, at 52.1 years in 2005.' },
      },
    ],
    gold: [
      {
        sql: 'select arg_min(country, life_expect) as country, min(life_expect) as years from {gapminder} where year = 2005',
        row: { country: 'South Africa', years: 52.1 },
      },
    ],
  }),
];
