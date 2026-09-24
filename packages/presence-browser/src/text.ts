import type { ComponentType } from 'react';

/** Public narration only. Hosts report accumulated public text, never model-private reasoning. */
export type PresenceTextProps = {
  text: string;
  /** Stable while a message grows. A new revision replaces the message or revisits a recorded one. */
  revision: number;
  /** Words are still arriving from the agent. */
  streaming: boolean;
  /** The view may reveal this revision with motion. False for replayed frames and reduced motion. */
  animate: boolean;
  reducedMotion: boolean;
};

/**
 * A message presentation for the bubble. `View` renders the words. `speak` turns the message into
 * the plain words a screen reader announces once the message settles.
 */
export type PresenceText = {
  View: ComponentType<PresenceTextProps>;
  speak?: (text: string) => string;
};
