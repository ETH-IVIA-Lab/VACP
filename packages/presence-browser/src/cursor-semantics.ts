import type { PresenceActivity } from '@vacp/presence-core';
import type { CursorShape } from './cursor-assets';

export type CursorPresentation = {
  shape: CursorShape;
  /** Shape while execution runs or activation is acknowledged. Defaults to shape. */
  activeShape?: CursorShape;
  /** Whether to acknowledge activation with press and ripple effects. Default: true. */
  feedback?: boolean;
};

/** Visual policy belongs to the renderer; custom surfaces can interpret the same intent differently. */
export function defaultCursorPresentation(activity: PresenceActivity): CursorPresentation {
  if (!activity.target || !activity.execution?.intent?.focus) return { shape: 'arrow', feedback: false };
  const interaction = activity.execution?.intent?.focus?.interaction;
  switch (interaction?.kind) {
    case 'point':
      return { shape: 'pointer', feedback: false };
    case 'activate':
      return { shape: 'pointer' };
    case 'brush':
      return { shape: 'crosshair' };
    case 'drag':
    case 'pan':
      return { shape: 'grab', activeShape: 'grabbing' };
    case 'edit':
      return { shape: 'text', feedback: false };
    case 'resize':
      return { shape: interaction.axis === 'x' ? 'resize-x' : interaction.axis === 'y' ? 'resize-y' : 'move' };
    case 'zoom':
      return { shape: interaction.direction ? `zoom-${interaction.direction}` : 'zoom' };
    default:
      return { shape: 'arrow' };
  }
}
