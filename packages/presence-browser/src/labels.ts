/**
 * Every word the overlay shows or announces around the agent's own sentences. A sentence about a view
 * receives `subject` when the step names its view, and `change` is the title of the step's action.
 */
export type PresenceLabels = {
  /** The first frame's name, as the bubble heading and on its trail mark. */
  start: string;
  /** A step frame's name. `position` counts from 1, and `count` is the number of steps in the request. */
  step: (position: number, count: number) => string;
  /** The last frame's name. */
  conclusion: string;
  /** The name of a human actor without a `label`. */
  human: string;
  /** The name of an agent actor without a `label`. */
  agent: string;
  /** The name of a system actor without a `label`. */
  system: string;
  /** The accessible name of the group of frame marks. */
  trail: string;
  /** The accessible name of the navigation around the step and close controls. */
  stepper: string;
  /** The control that shows the previous frame. */
  back: string;
  /** The control that shows the next frame. */
  forward: string;
  /** The close control during a review. It returns to the live view. */
  live: string;
  /** The close control of a retained step. */
  dismiss: string;
  /** The tooltip of the step controls and the other frame marks while the agent works. */
  working: string;
  /** The note under a frame that was only partly restored. */
  diverged: string;
  /** The bubble's sentence on the first frame when the agent wrote none. */
  before: string;
  /** The bubble's sentence on the last frame when the agent wrote none. */
  after: string;
  /** The bubble's sentence while the agent thinks, and after a step the view did not take. */
  looking: (subject?: string) => string;
  /** The bubble's sentence after a cancelled step. */
  leaving: (subject?: string) => string;
  /** The bubble's sentence while the view's outputs are still updating. */
  refreshing: (subject?: string) => string;
  /** The bubble's sentence while a step with a title runs. */
  applying: (change: string, subject?: string) => string;
  /** The bubble's sentence after a step with a title. */
  applied: (change: string, subject?: string) => string;
  /** The bubble's sentence while a step without a title runs. */
  updating: (subject?: string) => string;
  /** The bubble's sentence after a step without a title, and as `updated()` on a recorded step. */
  updated: (subject?: string) => string;
};

export const defaultLabels: PresenceLabels = {
  start: 'Start',
  step: (position, count) => `Step ${position} of ${count}`,
  conclusion: 'Conclusion',
  human: 'You',
  agent: 'Agent',
  system: 'System',
  trail: 'Request trail',
  stepper: 'Trail controls',
  back: 'Previous step',
  forward: 'Next step',
  live: 'Return to the live view',
  dismiss: 'Dismiss',
  working: 'Stepping resumes when the agent finishes',
  diverged: 'The view may differ slightly from the recording.',
  before: "The view before the agent's first change.",
  after: "The view after the agent's last change.",
  looking: (subject = 'the view') => `Looking at ${subject}`,
  leaving: (subject = 'the view') => `Leaving ${subject} as it was`,
  refreshing: (subject = 'The view') => `${subject} is still updating`,
  applying: (change, subject = 'the view') => `${change} in ${subject}`,
  applied: (change, subject = 'the view') => `${change} applied to ${subject}`,
  updating: (subject = 'the view') => `Updating ${subject}`,
  updated: (subject = 'the view') => `Updated ${subject}`,
};
