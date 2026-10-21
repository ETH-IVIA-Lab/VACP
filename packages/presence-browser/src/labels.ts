/** Every word the overlay shows or announces beyond the bubble's `describe` wording. */
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
};
