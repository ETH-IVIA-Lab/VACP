import type { PresenceActivity } from '@vacp/presence-core';

/**
 * Authoritative content and presentation identity. A new revision restarts the reveal; unchanged words
 * keep theirs even when a live turn hands them to a recorded step, so nothing is read twice.
 */
export function createNarration() {
  let text = '';
  let scope: string | undefined;
  let revision = 0;
  return {
    update(activity: PresenceActivity, next: string) {
      const identity = activity.recordId ?? activity.activityId ?? activity.execution?.id;
      const changedScope = identity !== scope;
      const changed = text !== next;
      const appended = !changedScope && text.length > 0 && next.startsWith(text);
      if (changed && !appended) revision++;
      scope = identity;
      text = next;
      return { text, revision, changed, animate: changed && !appended && activity.phase !== 'reviewing' };
    },
    read: () => text,
  };
}
