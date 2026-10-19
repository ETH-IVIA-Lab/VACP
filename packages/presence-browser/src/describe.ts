import type { PresenceActivity, PresenceNavigation, PresenceTrailFrame } from '@ethivia/vacp-presence';

export function actorLabel(actor: PresenceActivity['actor']): string {
  return actor.label ?? (actor.kind === 'human' ? 'You' : actor.kind === 'agent' ? 'Agent' : 'System');
}

/**
 * Wording when the agent has said nothing: what is happening to which view, never a phase name. A step
 * the view did not take stays the agent's to handle, so its wording claims no change and shows no error.
 */
export function describePresence(activity: PresenceActivity): string {
  if (activity.summary) return activity.summary;
  if (activity.frame === 'start') return "The view before the agent's first change.";
  if (activity.frame === 'conclusion') return "The view after the agent's last change.";
  if (activity.frame === 'step') return 'Updated the analysis';
  const view = activity.subject ?? 'the view';
  const change = activity.execution?.title;
  if (activity.phase === 'thinking' || activity.phase === 'failed') return `Looking at ${view}`;
  if (activity.phase === 'cancelled') return `Leaving ${view} as it was`;
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

/** A recorded frame is named by its place in the request. Live work is named by its view. */
export function headingOf(activity: PresenceActivity, navigation: PresenceNavigation | undefined): string {
  const frame = activity.recordId && navigation ? navigation.frames[navigation.index] : undefined;
  if (frame && navigation) return frameNames(navigation.frames)[navigation.index]!;
  return activity.subject ?? (activity.actor.kind === 'agent' ? '' : actorLabel(activity.actor));
}
