import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  parseVacpNarration,
  vacpNarrationGuidance,
  vacpProgressFields,
  vacpProgressGuidance,
  VACP_NARRATION_MAX_LENGTH,
} from '../src/index';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/narration.json', import.meta.url), 'utf8'));

test('every transport reads the same narration contract', () => {
  assert.equal(vacpProgressGuidance, fixture.progress);
  assert.deepEqual(vacpProgressFields, fixture.progressFields);
  assert.equal(vacpNarrationGuidance, fixture.narration);
  assert.equal(VACP_NARRATION_MAX_LENGTH, fixture.maxLength);
});

test('every transport parses a sentence the same way', () => {
  for (const { input, expected, error } of fixture.cases) {
    if (error) assert.throws(() => parseVacpNarration(input), new RegExp(error));
    else assert.equal(parseVacpNarration(input), expected);
  }
});
