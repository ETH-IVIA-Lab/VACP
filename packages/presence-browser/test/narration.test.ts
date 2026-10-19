import assert from 'node:assert/strict';
import test from 'node:test';
import type { PresenceActivity } from '@ethivia/vacp-presence-core';
import { createNarration } from '../src/narration';

const actor = { id: 'agent', kind: 'agent' as const };
const live: PresenceActivity = { actor, phase: 'thinking', activityId: 'turn-1', target: null, freshness: 'unknown' };
const recorded: PresenceActivity = {
  actor,
  phase: 'completed',
  recordId: 'step-3',
  target: null,
  freshness: 'unknown',
};

test('unchanged words keep their reveal when a finished turn hands them to the recorded step', () => {
  const narration = createNarration();
  const first = narration.update(live, 'Female athletes are now in view.');
  const handed = narration.update(recorded, 'Female athletes are now in view.');
  assert.equal(handed.revision, first.revision);
  assert.equal(handed.animate, first.animate, 'a revision keeps the reveal it began with');
});

test('appended words continue the reveal of their revision and replaced words start a new one', () => {
  const narration = createNarration();
  const start = narration.update(live, 'Keeping canoe');
  const appended = narration.update(live, 'Keeping canoe and rowing.');
  assert.equal(appended.revision, start.revision);
  assert.equal(appended.animate, true);
  const replaced = narration.update(live, 'Narrowing the ages.');
  assert.equal(replaced.revision, start.revision + 1);
  assert.equal(replaced.animate, true);
  const corrected = narration.update(live, 'Narrowing the Ages.');
  assert.equal(corrected.revision, replaced.revision + 1);
  assert.equal(corrected.text, 'Narrowing the Ages.');
});

test('reviewing a recorded step shows its words without an entrance animation', () => {
  const narration = createNarration();
  narration.update(live, 'Keeping canoe and rowing.');
  const review = narration.update({ ...recorded, phase: 'reviewing' }, 'Filtering for women.');
  assert.equal(review.animate, false);
});
