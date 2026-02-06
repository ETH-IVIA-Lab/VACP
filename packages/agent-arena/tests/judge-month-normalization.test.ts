import assert from 'node:assert/strict';
import { makeSolutionJudge } from '../agent-arena.scenarios.ts';

const weatherJudge = makeSolutionJudge({
  observations: [
    { month: 'January', tempMin: -1.1, tempMax: 7.2 },
    { month: 'February', tempMin: 5, tempMax: 6.7 },
    { month: 'March', tempMin: 5.6, tempMax: 11.1 },
    { month: 'April', tempMin: 9.4, tempMax: 9.4 },
    { month: 'November', tempMin: 4.4, tempMax: 4.4 },
    { month: 'December', tempMin: 3.9, tempMax: 8.3 },
  ],
});

const weatherAnswer = {
  observations: [
    { month: 'Jan', tempMin: -1.1, tempMax: 7.2 },
    { month: 'Feb.', tempMin: 5, tempMax: 6.7 },
    { month: 'Mar', tempMin: 5.6, tempMax: 11.1 },
    { month: 'Apr', tempMin: 9.4, tempMax: 9.4 },
    { month: 'Nov', tempMin: 4.4, tempMax: 4.4 },
    { month: 'Dec', tempMin: 3.9, tempMax: 8.3 },
  ],
};

const weatherResult = weatherJudge({
  scenarioId: 'vl-seattle-weather-t3-snow-season-temp-range',
  parseStatus: 'ok',
  answer: weatherAnswer,
});

assert.equal(weatherResult.semanticOk, true);
assert.equal(weatherResult.strictOk, false);
assert.equal(weatherResult.ok, true);

const strictStringJudge = makeSolutionJudge({
  observation: { month: 'January', label: 'Snow' },
});

const strictStringResult = strictStringJudge({
  scenarioId: 'unit',
  parseStatus: 'ok',
  answer: { observation: { month: 'Jan', label: 'snow' } },
});

assert.equal(strictStringResult.semanticOk, false);
assert.equal(strictStringResult.strictOk, false);

console.log('judge-month-normalization: ok');
