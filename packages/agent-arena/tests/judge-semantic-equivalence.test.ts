import assert from 'node:assert/strict';
import { makeIataIncludesJudge, makeSolutionJudge } from '../agent-arena.scenarios.ts';

const monthRangeJudge = makeSolutionJudge(
  {
    moreSunnyRange: 'August-October',
    moreRainyRange: 'February-April',
  },
  {
    semanticStringRules: {
      moreSunnyRange: 'month_range',
      moreRainyRange: 'month_range',
    },
  },
);

const monthRangeEquivalent = monthRangeJudge({
  scenarioId: 'vl-seattle-weather-t1-sun-vs-rain-feb-apr-aug-oct',
  parseStatus: 'ok',
  answer: {
    moreSunnyRange: 'Aug-Oct',
    moreRainyRange: 'Feb-Apr',
  },
});

assert.equal(monthRangeEquivalent.semanticOk, true);
assert.equal(monthRangeEquivalent.strictOk, false);
assert.equal(monthRangeEquivalent.ok, true);

const monthRangeEquivalentDash = monthRangeJudge({
  scenarioId: 'vl-seattle-weather-t1-sun-vs-rain-feb-apr-aug-oct',
  parseStatus: 'ok',
  answer: {
    moreSunnyRange: 'Aug - Oct',
    moreRainyRange: 'Feb–Apr',
  },
});

assert.equal(monthRangeEquivalentDash.semanticOk, true);
assert.equal(monthRangeEquivalentDash.strictOk, false);

const monthRangeWrong = monthRangeJudge({
  scenarioId: 'vl-seattle-weather-t1-sun-vs-rain-feb-apr-aug-oct',
  parseStatus: 'ok',
  answer: {
    moreSunnyRange: 'Feb-Apr',
    moreRainyRange: 'Aug-Oct',
  },
});

assert.equal(monthRangeWrong.semanticOk, false);
assert.equal(monthRangeWrong.strictOk, false);

const caseFoldJudge = makeSolutionJudge(
  { steeperSport: 'football' },
  { semanticStringRules: { steeperSport: 'case_fold' } },
);

const caseFoldEquivalent = caseFoldJudge({
  scenarioId: 'mosaic-athletes-t1-regression-football-vs-cycling',
  parseStatus: 'ok',
  answer: { steeperSport: 'Football' },
});

assert.equal(caseFoldEquivalent.semanticOk, true);
assert.equal(caseFoldEquivalent.strictOk, false);

const caseFoldWhitespace = caseFoldJudge({
  scenarioId: 'mosaic-athletes-t1-regression-football-vs-cycling',
  parseStatus: 'ok',
  answer: { steeperSport: '  FOOTBALL  ' },
});

assert.equal(caseFoldWhitespace.semanticOk, true);
assert.equal(caseFoldWhitespace.strictOk, false);

const caseFoldWrong = caseFoldJudge({
  scenarioId: 'mosaic-athletes-t1-regression-football-vs-cycling',
  parseStatus: 'ok',
  answer: { steeperSport: 'cycling' },
});

assert.equal(caseFoldWrong.semanticOk, false);
assert.equal(caseFoldWrong.strictOk, false);

const caseFoldWithoutRule = makeSolutionJudge({ steeperSport: 'football' });
const caseFoldWithoutRuleResult = caseFoldWithoutRule({
  scenarioId: 'mosaic-athletes-t1-regression-football-vs-cycling',
  parseStatus: 'ok',
  answer: { steeperSport: 'Football' },
});

assert.equal(caseFoldWithoutRuleResult.semanticOk, false);
assert.equal(caseFoldWithoutRuleResult.strictOk, false);

const nestedPathJudge = makeSolutionJudge(
  {
    summary: {
      bestRanges: [{ label: 'August-October' }],
    },
  },
  {
    semanticStringRules: {
      'summary.bestRanges.label': 'month_range',
    },
  },
);

const nestedPathEquivalent = nestedPathJudge({
  scenarioId: 'unit',
  parseStatus: 'ok',
  answer: {
    summary: {
      bestRanges: [{ label: 'Aug-Oct' }],
    },
  },
});

assert.equal(nestedPathEquivalent.semanticOk, true);
assert.equal(nestedPathEquivalent.strictOk, false);

const nestedPathWrong = nestedPathJudge({
  scenarioId: 'unit',
  parseStatus: 'ok',
  answer: {
    summary: {
      bestRanges: [{ label: 'Feb-Apr' }],
    },
  },
});

assert.equal(nestedPathWrong.semanticOk, false);
assert.equal(nestedPathWrong.strictOk, false);

const iataAliasJudge = makeIataIncludesJudge(
  { airport: 'FAR', topDestination: 'MSP' },
  {
    airportAliases: ['Hector International'],
    topDestinationAliases: ['Minneapolis-St Paul Intl'],
  },
);

const iataAliasNameOnly = iataAliasJudge({
  scenarioId: 'vl-airports-t1-nd-most-outgoing-top-destination',
  parseStatus: 'ok',
  answer: {
    airport: 'Hector International',
    topDestination: 'Minneapolis-St Paul Intl',
  },
});

assert.equal(iataAliasNameOnly.semanticOk, true);
assert.equal(iataAliasNameOnly.strictOk, false);
assert.equal(iataAliasNameOnly.ok, true);

const iataAliasMixedWithCodes = iataAliasJudge({
  scenarioId: 'vl-airports-t1-nd-most-outgoing-top-destination',
  parseStatus: 'ok',
  answer: {
    airport: 'Hector International (FAR)',
    topDestination: 'MSP - Minneapolis-St Paul Intl',
  },
});

assert.equal(iataAliasMixedWithCodes.semanticOk, true);
assert.equal(iataAliasMixedWithCodes.strictOk, false);
assert.equal(iataAliasMixedWithCodes.ok, true);

const iataAliasWrongDestination = iataAliasJudge({
  scenarioId: 'vl-airports-t1-nd-most-outgoing-top-destination',
  parseStatus: 'ok',
  answer: {
    airport: 'Hector International',
    topDestination: "Chicago O'Hare International",
  },
});

assert.equal(iataAliasWrongDestination.semanticOk, false);
assert.equal(iataAliasWrongDestination.strictOk, false);
assert.equal(iataAliasWrongDestination.ok, false);

console.log('judge-semantic-equivalence: ok');
