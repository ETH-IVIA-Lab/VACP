import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  vacpAgentActor,
  vacpAgentToolGuidance,
  vacpAgentTools,
  vacpToolCapabilitiesRequest,
  vacpToolStateRequest,
} from '../src/index';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/agent-tools.json', import.meta.url), 'utf8'));

test('every transport offers the same agent tools with the same guidance', () => {
  assert.deepEqual(vacpAgentTools, fixture.tools);
  assert.equal(vacpAgentToolGuidance, fixture.guidance);
});

test('every transport attributes agent steps to the same default actor', () => {
  assert.deepEqual(vacpAgentActor, fixture.actor);
});

test('every transport turns tool input into the same capabilities and state requests', () => {
  for (const { input, expected } of fixture.capabilities)
    assert.deepEqual(vacpToolCapabilitiesRequest(input), expected);
  for (const { input, expected } of fixture.state) assert.deepEqual(vacpToolStateRequest(input), expected);
});
