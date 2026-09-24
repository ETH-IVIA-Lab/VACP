import type { PresenceActivity, PresenceNavigation, PresenceTrailFrame } from '@vacp/presence-core';

export function actorLabel(actor: PresenceActivity['actor']): string {
  return actor.label ?? (actor.kind === 'human' ? 'You' : actor.kind === 'agent' ? 'Agent' : 'System');
}

/** Wording when the agent has said nothing: what is happening to which view, never a phase name. */
export function describePresence(activity: PresenceActivity): string {
  if (activity.summary) return activity.summary;
  const view = activity.subject ?? 'the view';
  const change = activity.execution?.title;
  if (activity.phase === 'thinking') return `Looking at ${view}`;
  if (activity.phase === 'failed') return `${change ?? 'The change'} could not be applied to ${view}`;
  if (activity.phase === 'cancelled') return `Stopped before changing ${view}`;
  if (activity.freshness === 'error') return `${view} could not finish updating`;
  if (activity.freshness === 'updating') return `${view} is still updating`;
  if (activity.phase === 'completed' || activity.phase === 'reviewing')
    return change ? `${change} applied to ${view}` : `Updated ${view}`;
  return change ? `${change} in ${view}` : `Updating ${view}`;
}

/** The name of every frame of a request, as the heading and the rail say it: "Start", "Step 2 of 5", "Conclusion". */
export function frameNames(frames: readonly PresenceTrailFrame[]): string[] {
  const steps = frames.filter((frame) => frame === 'step').length;
  let step = 0;
  return frames.map((frame) =>
    frame === 'start' ? 'Start' : frame === 'conclusion' ? 'Conclusion' : `Step ${++step} of ${steps}`,
  );
}

/** A recorded frame is named by its place in the request; live work by the view it works on. */
export function headingOf(activity: PresenceActivity, navigation: PresenceNavigation | undefined): string {
  const frame = activity.recordId && navigation ? navigation.frames[navigation.index] : undefined;
  if (frame && navigation) {
    if (frame === 'conclusion' && activity.phase === 'failed') return 'Did not finish';
    if (frame === 'conclusion' && activity.phase === 'cancelled') return 'Stopped';
    return frameNames(navigation.frames)[navigation.index]!;
  }
  if (activity.phase === 'failed') return `${activity.subject ?? 'This step'} could not be completed`;
  if (activity.phase === 'cancelled') return 'Stopped';
  return activity.subject ?? (activity.actor.kind === 'agent' ? '' : actorLabel(activity.actor));
}
