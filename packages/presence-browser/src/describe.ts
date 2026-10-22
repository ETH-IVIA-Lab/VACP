import type { PresenceActivity, PresenceNavigation, PresenceTrailFrame } from '@ethivia/vacp-presence';
import type { PresenceLabels } from './labels';

export function actorLabel(actor: PresenceActivity['actor'], labels: PresenceLabels): string {
  return actor.label ?? (actor.kind === 'human' ? labels.human : actor.kind === 'agent' ? labels.agent : labels.system);
}

/**
 * Wording when the agent has said nothing: what is happening to which view, never a phase name. A step
 * the view did not take stays the agent's to handle, so its wording claims no change and shows no error.
 */
export function describePresence(activity: PresenceActivity, labels: PresenceLabels): string {
  if (activity.summary) return activity.summary;
  if (activity.frame === 'start') return labels.before;
  if (activity.frame === 'conclusion') return labels.after;
  if (activity.frame === 'step') return labels.updated();
  const { subject } = activity;
  const change = activity.execution?.title;
  if (activity.phase === 'thinking' || activity.phase === 'failed') return labels.looking(subject);
  if (activity.phase === 'cancelled') return labels.leaving(subject);
  if (activity.freshness === 'updating') return labels.refreshing(subject);
  if (activity.phase === 'completed' || activity.phase === 'reviewing')
    return change ? labels.applied(change, subject) : labels.updated(subject);
  return change ? labels.applying(change, subject) : labels.updating(subject);
}

/** The name of every frame of a request, as the heading and the rail say it, such as "Step 2 of 5". */
export function frameNames(frames: readonly PresenceTrailFrame[], labels: PresenceLabels): string[] {
  const steps = frames.filter((frame) => frame === 'step').length;
  let step = 0;
  return frames.map((frame) =>
    frame === 'start' ? labels.start : frame === 'conclusion' ? labels.conclusion : labels.step(++step, steps),
  );
}

/** A recorded frame is named by its place in the request. Live work is named by its view. */
export function headingOf(
  activity: PresenceActivity,
  navigation: PresenceNavigation | undefined,
  labels: PresenceLabels,
): string {
  const frame = activity.recordId && navigation ? navigation.frames[navigation.index] : undefined;
  if (frame && navigation) return frameNames(navigation.frames, labels)[navigation.index]!;
  return activity.subject ?? (activity.actor.kind === 'agent' ? '' : actorLabel(activity.actor, labels));
}
