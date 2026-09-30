import assert from 'node:assert/strict';
import test from 'node:test';

import { vacpAgentToolGuidance } from '@vacp/protocol';

import { buildVacpAgentInstructions, defaultVacpAgentInstructions } from '../src/instructions';

test('default instructions carry the shared tool guidance, the product policies, and the interaction policy', () => {
  const instructions = buildVacpAgentInstructions();
  assert.equal(instructions.startsWith(defaultVacpAgentInstructions), true);
  assert.ok(instructions.includes(vacpAgentToolGuidance));
  assert.match(instructions, /vacp\.widget_options/i);
  assert.match(instructions, /operation\.contract/i);
  assert.match(instructions, /no item\/filter\/selection is active/i);
  assert.match(instructions, /observable interaction over text-only explanations/i);
  assert.match(instructions, /at least 1 vacp_execute call/i);
  assert.match(instructions, /at least 3 total tool call/i);
});

test('explicit base instructions with the interaction policy off are used as given', () => {
  const custom = buildVacpAgentInstructions({
    baseInstructions: 'custom base',
    interactionPolicy: { requireUiDemonstration: false },
  });

  assert.equal(custom, 'custom base');
});
