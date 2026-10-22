import assert from 'node:assert/strict';
import test from 'node:test';
import type { PresenceActivity, PresenceNavigation, PresenceTrailFrame } from '@ethivia/vacp-presence';
import { resolvePresenceOptions, type BrowserPresenceOptions } from '../src/options';
import { createSlots } from '../src/slots';

const german: BrowserPresenceOptions['labels'] = {
  start: 'Anfang',
  step: (position, count) => `Schritt ${position} von ${count}`,
  conclusion: 'Ergebnis',
  human: 'Sie',
  system: 'Hintergrunddienst',
};

const slotsOf = (options: BrowserPresenceOptions = {}) => {
  const config = resolvePresenceOptions(options);
  return createSlots({ describe: config.describe, cursor: config.cursor.resolve, labels: config.labels });
};

const navigation = (frames: PresenceTrailFrame[], index: number): PresenceNavigation => ({
  frames,
  index,
  canBack: true,
  canForward: true,
  reviewing: true,
  restoring: false,
  working: false,
  diverged: false,
  go() {},
  back() {},
  forward() {},
  close() {},
});

const recorded = (frame: PresenceTrailFrame): PresenceActivity => ({
  actor: { id: 'agent', kind: 'agent' },
  phase: 'reviewing',
  recordId: frame,
  frame,
  target: null,
  freshness: 'unknown',
});

const headings = (options?: BrowserPresenceOptions) => {
  const frames: PresenceTrailFrame[] = ['start', 'step', 'step', 'conclusion'];
  const slots = slotsOf(options);
  return frames.map((frame, index) => {
    slots.update([recorded(frame)], navigation(frames, index), true);
    return slots.list()[0]!.heading;
  });
};

const speakers = (options?: BrowserPresenceOptions) => {
  const slots = slotsOf(options);
  slots.update(
    [
      { actor: { id: 'person', kind: 'human' }, phase: 'acting', target: null, freshness: 'unknown' },
      { actor: { id: 'assistant', kind: 'agent' }, phase: 'acting', target: null, freshness: 'unknown' },
      { actor: { id: 'scheduler', kind: 'system' }, phase: 'acting', target: null, freshness: 'unknown' },
      {
        actor: { id: 'editor', kind: 'human', label: 'Redaktion' },
        phase: 'acting',
        target: null,
        freshness: 'unknown',
      },
    ],
    undefined,
    true,
  );
  return slots.list().map((slot) => slot.speaker);
};

test('recorded frames are headed Start, Step n of m, and Conclusion by default', () => {
  assert.deepEqual(headings(), ['Start', 'Step 1 of 2', 'Step 2 of 2', 'Conclusion']);
});

test('recorded frames are headed by the supplied frame labels', () => {
  assert.deepEqual(headings({ labels: german }), ['Anfang', 'Schritt 1 von 2', 'Schritt 2 von 2', 'Ergebnis']);
});

test('an actor without its own label speaks under the fallback name for its kind', () => {
  assert.deepEqual(speakers(), ['You', 'Agent', 'System', 'Redaktion']);
  assert.deepEqual(speakers({ labels: german }), ['Sie', 'Agent', 'Hintergrunddienst', 'Redaktion']);
});

test('an empty or non-string label is rejected by name', () => {
  const cases = [
    [{ back: '' }, 'Presence label back requires text'],
    [{ dismiss: '  ' }, 'Presence label dismiss requires text'],
    [{ live: 3 }, 'Presence label live requires text'],
    [{ step: 'Schritt' }, 'Presence label step requires a function'],
    [{ before: ' ' }, 'Presence label before requires text'],
    [{ looking: 'Betrachte' }, 'Presence label looking requires a function'],
  ] as const;
  for (const [labels, message] of cases)
    assert.throws(() => resolvePresenceOptions({ labels: labels as never }), { message });
});

test('a label left undefined keeps its default', () => {
  assert.deepEqual(headings({ labels: { start: undefined, conclusion: 'Ergebnis' } }), [
    'Start',
    'Step 1 of 2',
    'Step 2 of 2',
    'Ergebnis',
  ]);
});
