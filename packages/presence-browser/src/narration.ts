import type { PresenceActivity } from '@ethivia/vacp-presence-core';

/**
 * Authoritative content and presentation identity. A new revision restarts the reveal, and whether it
 * may animate is decided once for the whole revision. Unchanged words keep their revision even when a
 * live turn hands them to a recorded step, so nothing is read twice.
 */
export function createNarration() {
  let text = '';
  let scope: string | undefined;
  let revision = 0;
  let animate = false;
  return {
    update(activity: PresenceActivity, next: string) {
      const identity = activity.recordId ?? activity.activityId ?? activity.execution?.id;
      const appended = identity === scope && text.length > 0 && next.startsWith(text);
      if (text !== next && !appended) {
        revision++;
        animate = activity.phase !== 'reviewing';
      }
      scope = identity;
      text = next;
      return { text, revision, animate };
    },
  };
}
