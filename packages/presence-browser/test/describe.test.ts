import assert from 'node:assert/strict';
import test from 'node:test';
import type { PresenceActivity } from '@ethivia/vacp-presence';
import { resolvePresenceOptions, type BrowserPresenceOptions } from '../src/options';

const german: BrowserPresenceOptions['labels'] = {
  before: 'Die Ansicht vor der ersten Änderung.',
  after: 'Die Ansicht nach der letzten Änderung.',
  looking: (subject = 'die Ansicht') => `Betrachte ${subject}`,
  leaving: (subject = 'die Ansicht') => `Lasse ${subject} unverändert`,
  refreshing: (subject = 'Die Ansicht') => `${subject} wird noch aktualisiert`,
  applying: (change, subject = 'der Ansicht') => `${change} in ${subject}`,
  applied: (change, subject = 'die Ansicht') => `${change} auf ${subject} angewendet`,
  updating: (subject = 'die Ansicht') => `Aktualisiere ${subject}`,
  updated: (subject = 'Ansicht') => `${subject} aktualisiert`,
};

const agent = { id: 'agent', kind: 'agent' } as const;
const untitled = {
  id: 'run',
  callId: 'run',
  sequence: 1,
  name: 'set',
  actor: agent,
  phase: 'running',
  at: '',
} as const;
const titled = { ...untitled, title: 'Filter range' };

const activity = (fields: Partial<PresenceActivity>): PresenceActivity => ({
  actor: agent,
  phase: 'acting',
  target: null,
  freshness: 'unknown',
  ...fields,
});

/** One activity for every branch of the built-in wording, with its English and German sentence. */
const cases: [PresenceActivity, string, string][] = [
  [activity({ summary: 'Keeping the selected rows.' }), 'Keeping the selected rows.', 'Keeping the selected rows.'],
  [
    activity({ phase: 'reviewing', recordId: 'start', frame: 'start' }),
    "The view before the agent's first change.",
    'Die Ansicht vor der ersten Änderung.',
  ],
  [
    activity({ phase: 'reviewing', recordId: 'end', frame: 'conclusion' }),
    "The view after the agent's last change.",
    'Die Ansicht nach der letzten Änderung.',
  ],
  [activity({ phase: 'reviewing', recordId: 'step', frame: 'step' }), 'Updated the view', 'Ansicht aktualisiert'],
  [activity({ phase: 'thinking', subject: 'Price chart' }), 'Looking at Price chart', 'Betrachte Price chart'],
  [activity({ phase: 'failed', execution: titled }), 'Looking at the view', 'Betrachte die Ansicht'],
  [
    activity({ phase: 'cancelled', subject: 'Price chart' }),
    'Leaving Price chart as it was',
    'Lasse Price chart unverändert',
  ],
  [
    activity({ phase: 'completed', freshness: 'updating', execution: titled }),
    'The view is still updating',
    'Die Ansicht wird noch aktualisiert',
  ],
  [
    activity({ phase: 'completed', subject: 'Price chart', execution: titled }),
    'Filter range applied to Price chart',
    'Filter range auf Price chart angewendet',
  ],
  [activity({ phase: 'reviewing', subject: 'Price chart' }), 'Updated Price chart', 'Price chart aktualisiert'],
  [activity({ execution: titled }), 'Filter range in the view', 'Filter range in der Ansicht'],
  [activity({ subject: 'Price chart', execution: untitled }), 'Updating Price chart', 'Aktualisiere Price chart'],
];

test('a step the agent did not narrate is described in English by default', () => {
  const { describe } = resolvePresenceOptions({});
  assert.deepEqual(
    cases.map(([step]) => describe(step)),
    cases.map(([, english]) => english),
  );
});

test('a step the agent did not narrate is described with the supplied sentence labels', () => {
  const { describe } = resolvePresenceOptions({ labels: german });
  assert.deepEqual(
    cases.map(([step]) => describe(step)),
    cases.map(([, , translated]) => translated),
  );
});

test('a describe override delegates to the built-in wording in the supplied labels', () => {
  const { describe } = resolvePresenceOptions({
    labels: german,
    describe: (step, wording) => (step.phase === 'cancelled' ? 'Abgebrochen' : wording(step)),
  });
  assert.equal(describe(activity({ phase: 'cancelled' })), 'Abgebrochen');
  assert.equal(describe(activity({ phase: 'thinking' })), 'Betrachte die Ansicht');
});
