import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { vacpToolRead, type VacpObservation } from '../src/index';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/tool-read.json', import.meta.url), 'utf8'));

test('a graph read reaches a model without source ownership', () => {
  assert.deepEqual(vacpToolRead(fixture.read as VacpObservation), fixture.expected);
});
