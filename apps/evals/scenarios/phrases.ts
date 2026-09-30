import { mentions } from '../src';

/**
 * The reply says plainly that the page cannot do what was asked: "can't", "couldn't", "unable",
 * "not possible", or that the page doesn't have, offer, support, expose, or provide it.
 */
export const declines = () =>
  mentions(
    /\b(?:can't|cannot|couldn't|could not|unable|not possible|isn't possible|no way to|(?:doesn't|does not|don't|do not) (?:have|offer|support|expose|provide|include)|(?:isn't|is not|not) (?:available|supported))\b/,
    { label: 'declines' },
  );
