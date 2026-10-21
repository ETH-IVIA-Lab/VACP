/**
 * The agent-facing narration contract every transport offers. The wording lives here once so each
 * transport asks for the same thing. `test/fixtures/narration.json` holds the same values for the
 * Python server. Lengths count Unicode code points, as JSON Schema `maxLength` does.
 */
export const VACP_NARRATION_MAX_LENGTH = 280;

/** Description of the progress tool: one sentence before the work and one when it is done. */
export const vacpProgressGuidance =
  'Tell the person watching what you are about to do, in one short plain sentence in the language they read on screen. ' +
  'Call it once before your first action. Set done to true with a brief closing sentence in the same language that states the result. ' +
  'Every action also carries its own narration, so each step shows its own reason.';

/** Description of the `narration` field on every action tool: the step's own sentence. */
export const vacpNarrationGuidance =
  'One short present-tense sentence for the person watching, in the language they read on screen: what this step changes and why, ' +
  'for example "Keeping the two chosen options so they can be compared". ' +
  'Write a new sentence for every step. Leave out tool names, references, ids, and remarks about yourself.';

/** Descriptions of the progress tool's two fields. */
export const vacpProgressFields = {
  message: 'One plain sentence for the person.',
  done: 'True when this message closes the current task.',
} as const;

/**
 * Unicode White_Space characters, the set every transport trims from a sentence. JavaScript `trim()`
 * and Python `strip()` each use a different set, so neither is used.
 */
const WHITESPACE = '\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000';
const EDGES = new RegExp(`^[${WHITESPACE}]+|[${WHITESPACE}]+$`, 'gu');

export function trimVacpWhitespace(value: string): string {
  return value.replace(EDGES, '');
}

/**
 * A sentence for the person watching, trimmed of Unicode White_Space. Missing, blank, and sentences
 * longer than `VACP_NARRATION_MAX_LENGTH` code points are rejected.
 */
export function parseVacpNarration(value: unknown, field = 'narration'): string {
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string`);
  const text = trimVacpWhitespace(value);
  if (!text) throw new TypeError(`${field} requires a sentence`);
  let length = 0;
  for (const _ of text)
    if (++length > VACP_NARRATION_MAX_LENGTH)
      throw new TypeError(`${field} is at most ${VACP_NARRATION_MAX_LENGTH} characters`);
  return text;
}
