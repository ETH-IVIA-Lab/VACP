import assert from 'node:assert/strict';
import test from 'node:test';
import type { PresenceActivity } from '@vacp/presence-core';
import { defaultCursorPresentation } from '../src/cursor-semantics';
import { describePresence } from '../src/describe';
import { createSlots } from '../src/slots';

const slotsOf = () => createSlots({ describe: describePresence, cursor: defaultCursorPresentation });

const analyst = { id: 'analyst', kind: 'agent' as const };
const reviewer = { id: 'reviewer', kind: 'agent' as const };
const activity = (overrides: Partial<PresenceActivity>): PresenceActivity => ({
  actor: analyst,
  phase: 'acting',
  target: null,
  freshness: 'unknown',
  ...overrides,
});

test('a finished turn hands its pointer to the recorded trail and keeps its place', () => {
  const slots = slotsOf();
  slots.update([activity({ summary: 'Keeping female athletes.' })], undefined, false);
  const [live] = slots.list();
  slots.update(
    [activity({ phase: 'completed', recordId: 'step-1', summary: 'Keeping female athletes.' })],
    undefined,
    false,
  );
  const [recorded] = slots.list();
  assert.equal(slots.list().length, 1);
  assert.equal(recorded!.id, live!.id);
  assert.equal(recorded!.message.revision, live!.message.revision);
});

test('a departed actor fades before it is removed, unless the frame is reviewed or motion is still', () => {
  const slots = slotsOf();
  slots.update([activity({}), activity({ actor: reviewer })], undefined, false);
  slots.update([activity({})], undefined, false);
  const leaving = slots.list().find((slot) => slot.key === reviewer.id)!;
  assert.equal(leaving.exiting, true);
  assert.equal(slots.exited(leaving.id), true);
  assert.deepEqual(
    slots.list().map((slot) => slot.key),
    [analyst.id],
  );

  slots.update([activity({}), activity({ actor: reviewer })], undefined, false);
  slots.update([activity({})], undefined, true);
  assert.deepEqual(
    slots.list().map((slot) => slot.key),
    [analyst.id],
  );
});

test('an actor that returns while fading keeps its pointer', () => {
  const slots = slotsOf();
  slots.update([activity({}), activity({ actor: reviewer })], undefined, false);
  const first = slots.list().find((slot) => slot.key === reviewer.id)!;
  slots.update([activity({})], undefined, false);
  slots.update([activity({}), activity({ actor: reviewer })], undefined, false);
  const returned = slots.list().find((slot) => slot.key === reviewer.id)!;
  assert.equal(returned.id, first.id);
  assert.equal(returned.exiting, false);
});

test('the waiting line holds the place of the narration without advancing it', () => {
  const slots = slotsOf();
  slots.update([activity({ summary: 'Comparing rowers.' })], undefined, false);
  const spoken = slots.list()[0]!.message;
  slots.update([activity({ phase: 'thinking', subject: 'Age distribution' })], undefined, false);
  const waiting = slots.list()[0]!;
  assert.equal(waiting.waiting, true);
  assert.equal(waiting.words, 'Looking at Age distribution');
  assert.deepEqual(waiting.message, spoken);
});

test('an unchanged frame keeps every slot, so the overlay draws nothing new', () => {
  const slots = slotsOf();
  const frame = [activity({ summary: 'Keeping canoe and rowing.' })];
  assert.equal(slots.update(frame, undefined, false).changed, true);
  const drawn = slots.list();
  assert.equal(slots.update([activity({ summary: 'Keeping canoe and rowing.' })], undefined, false).changed, false);
  assert.equal(slots.list(), drawn);
});

test('a step the view did not take reads as the agent still working, never as an error', () => {
  const slots = slotsOf();
  const execution = {
    id: 'step',
    callId: 'step',
    sequence: 1,
    name: 'set',
    title: 'Filter range',
    actor: analyst,
    at: '',
  } as const;
  for (const phase of ['failed', 'cancelled'] as const) {
    slots.update(
      [activity({ phase, subject: 'Age distribution', execution: { ...execution, phase } })],
      undefined,
      false,
    );
    const [slot] = slots.list();
    assert.equal(slot!.heading, 'Age distribution');
    assert.doesNotMatch(`${slot!.heading} ${slot!.words}`, /could not|did not|stopped|error|fail/i);
  }
});
