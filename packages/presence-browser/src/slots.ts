import type { PresenceActivity, PresenceNavigation, PresencePoint } from '@vacp/presence-core';
import type { CursorShape } from './cursor-assets';
import type { CursorPresentation } from './cursor-semantics';
import { actorLabel, headingOf } from './describe';
import { createNarration } from './narration';

export type SlotKey = string | symbol;

/** What one pointer shows for a frame. Immutable, and reused while nothing in it changes. */
export type Slot = Readonly<{
  /** Stable across the hand-off between a live turn and the recorded trail, so the pointer keeps its place. */
  id: number;
  key: SlotKey;
  /** Pointers present when this one appeared, which spaces idle fallbacks apart. */
  stack: number;
  /** Left the frame and fades out before it is removed. */
  exiting: boolean;
  phase: PresenceActivity['phase'];
  speaker: string;
  agent: boolean;
  /** Thinking or acting: the mark shows the agent at work. */
  busy: boolean;
  heading: string;
  /** The status wording, or the waiting line while the agent thinks without a public summary. */
  words: string;
  waiting: boolean;
  message: Readonly<{ text: string; revision: number; animate: boolean }>;
  /** Words are still arriving from the agent. */
  streaming: boolean;
  /** A recorded frame of a request with more than one frame shows the request's rail. */
  trail: boolean;
  cursor: Readonly<{ shape: CursorShape; active: CursorShape; feedback: boolean; running: boolean }>;
}>;

type Entry = { slot: Slot; activity: PresenceActivity; narration: ReturnType<typeof createNarration> };

const silent = Object.freeze({ text: '', revision: 0, animate: false });
const trail = Symbol('analytical-trail');
const keyOf = (activity: PresenceActivity): SlotKey => (activity.recordId ? trail : activity.actor.id);

function same(a: Slot, b: Slot): boolean {
  return (Object.keys(a) as (keyof Slot)[]).every((key) => {
    const left = a[key];
    const right = b[key];
    if (left === right) return true;
    if (typeof left !== 'object' || typeof right !== 'object' || !left || !right) return false;
    return Object.keys(left).every((field) => (left as never)[field] === (right as never)[field]);
  });
}

/**
 * Pointer identity and presentation across frames. Recorded frames share one trail pointer; live
 * work has one pointer per actor. A finished turn hands its pointer to the trail, and back.
 */
export function createSlots(options: {
  describe: (activity: PresenceActivity) => string;
  cursor: (activity: PresenceActivity) => CursorPresentation;
}) {
  const entries = new Map<SlotKey, Entry>();
  /** Where departed actors last rested, so a returning one continues from there. */
  const positions = new Map<SlotKey, PresencePoint>();
  let nextId = 0;
  let list: readonly Slot[] = Object.freeze([]);
  const handOff = (activities: readonly PresenceActivity[]) => {
    if (activities.length !== 1 || entries.size !== 1) return;
    const [previous, entry] = entries.entries().next().value!;
    const next = keyOf(activities[0]!);
    if (previous === next || !(entry.activity.recordId || activities[0]!.recordId)) return;
    entries.delete(previous);
    entries.set(next, { ...entry, slot: Object.freeze({ ...entry.slot, key: next }) });
  };
  const present = (entry: Entry | undefined, slot: Slot, activity: PresenceActivity, narration: Entry['narration']) => {
    const kept = entry && same(entry.slot, slot) ? entry.slot : Object.freeze(slot);
    entries.set(slot.key, { slot: kept, activity, narration });
  };
  const publish = () => {
    const next = [...entries.values()].map((entry) => entry.slot);
    const changed = next.length !== list.length || next.some((slot, index) => slot !== list[index]);
    if (changed) list = Object.freeze(next);
    return changed;
  };
  return {
    /**
     * Apply a frame and return whether any slot changed. `immediate` removes departed pointers at once
     * instead of fading them, as does a reviewed frame.
     */
    update(activities: readonly PresenceActivity[], navigation: PresenceNavigation | undefined, immediate: boolean) {
      handOff(activities);
      const shown = new Set<SlotKey>();
      for (const activity of activities) {
        const key = keyOf(activity);
        shown.add(key);
        const entry = entries.get(key);
        const narration = entry?.narration ?? createNarration();
        const words = options.describe(activity);
        const waiting = activity.phase === 'thinking' && !activity.summary;
        // The waiting line holds the narration's place; the narration itself advances only with words.
        const message = waiting ? (entry?.slot.message ?? silent) : narration.update(activity, words);
        const busy = activity.phase === 'thinking' || activity.phase === 'acting';
        const cursor = options.cursor(activity);
        present(
          entry,
          {
            id: entry?.slot.id ?? nextId++,
            key,
            stack: entry?.slot.stack ?? entries.size,
            exiting: false,
            phase: activity.phase,
            speaker: actorLabel(activity.actor),
            agent: activity.actor.kind === 'agent',
            busy,
            heading: headingOf(activity, navigation),
            words,
            waiting,
            message: Object.freeze({ ...message }),
            streaming: !!activity.summary && busy,
            trail: !!activity.recordId && !!navigation && navigation.frames.length > 1,
            cursor: Object.freeze({
              shape: cursor.shape,
              active: cursor.activeShape ?? cursor.shape,
              feedback: cursor.feedback !== false,
              running: activity.execution?.phase === 'running' && activity.phase === 'acting',
            }),
          },
          activity,
          narration,
        );
      }
      const reviewing = activities.some((activity) => activity.phase === 'reviewing');
      const removed: Slot[] = [];
      for (const [key, entry] of entries) {
        if (shown.has(key) || entry.slot.exiting) continue;
        if (immediate || reviewing) {
          entries.delete(key);
          removed.push(entry.slot);
        } else entry.slot = Object.freeze({ ...entry.slot, exiting: true });
      }
      return { changed: publish(), removed };
    },
    /** A departed pointer finished fading. Returns whether anything changed. */
    exited(id: number) {
      for (const [key, entry] of entries)
        if (entry.slot.id === id && entry.slot.exiting) {
          entries.delete(key);
          return publish();
        }
      return false;
    },
    /** Drop every fading pointer at once, returning the dropped slots. */
    settle() {
      const removed = [...entries.values()].flatMap((entry) => (entry.slot.exiting ? [entry.slot] : []));
      for (const slot of removed) entries.delete(slot.key);
      publish();
      return removed;
    },
    list: () => list,
    activity: (id: number) => [...entries.values()].find((entry) => entry.slot.id === id)?.activity,
    remember(key: SlotKey, point: PresencePoint) {
      positions.delete(key);
      positions.set(key, point);
      while (positions.size > 32) positions.delete(positions.keys().next().value!);
    },
    recall: (key: SlotKey) => positions.get(key),
  };
}
