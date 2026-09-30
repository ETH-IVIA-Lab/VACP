import assert from 'node:assert/strict';
import test from 'node:test';
import { formatVacpWallClock, parseVacpInstant } from '../src/index';

// Local-clock expectations come from the same local calendar, so the tests hold in any time zone.
const localMidnight = new Date(2012, 5, 1).getTime();

test('a date means its midnight on the axis clock', () => {
  assert.equal(parseVacpInstant('2012-06-01', 'utc'), Date.UTC(2012, 5, 1));
  assert.equal(parseVacpInstant('2012-06-01', 'local'), localMidnight);
  assert.equal(parseVacpInstant('2012-06-01T13:45', 'utc'), Date.UTC(2012, 5, 1, 13, 45));
});

test('an offset names its instant on either clock', () => {
  for (const clock of ['local', 'utc'] as const) {
    assert.equal(parseVacpInstant('2012-06-01T00:00:00Z', clock), Date.UTC(2012, 5, 1));
    assert.equal(parseVacpInstant('2012-06-01T02:00:00+02:00', clock), Date.UTC(2012, 5, 1));
  }
});

test('text that names no calendar instant is rejected', () => {
  for (const text of ['June 1, 2012', '2012-13-01', '2012-02-30', '2012-06-01T24:00', '1338508800000', ''])
    assert.throws(() => parseVacpInstant(text, 'utc'), RangeError, text);
});

test('an instant reads back as the wall clock it was written on', () => {
  assert.equal(formatVacpWallClock(Date.UTC(2012, 5, 1, 13, 45, 7, 9), 'utc'), '2012-06-01T13:45:07.009');
  assert.equal(formatVacpWallClock(localMidnight, 'local'), '2012-06-01T00:00:00.000');
  assert.equal(parseVacpInstant(formatVacpWallClock(localMidnight, 'local'), 'local'), localMidnight);
});
