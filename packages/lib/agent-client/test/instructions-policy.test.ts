import assert from 'node:assert/strict';
import test from 'node:test';

import { buildVacpAgentInstructions, defaultVacpAgentInstructions } from '../src/instructions';

test('buildVacpAgentInstructions appends interaction policy guidance by default', () => {
  const instructions = buildVacpAgentInstructions();
  assert.match(instructions, /observable interaction over text-only explanations/i);
  assert.match(instructions, /at least 1 vacp_execute call/i);
  assert.match(instructions, /at least 3 total tool call/i);
});

test('buildVacpAgentInstructions respects explicit base instructions and disabled policy', () => {
  const custom = buildVacpAgentInstructions({
    baseInstructions: 'custom base',
    interactionPolicy: { requireUiDemonstration: false },
  });
  assert.equal(custom, 'custom base');
});

test('default instructions remain part of composed output', () => {
  const instructions = buildVacpAgentInstructions();
  assert.equal(instructions.startsWith(defaultVacpAgentInstructions), true);
});
