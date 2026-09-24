/**
 * The agent-facing narration contract every transport offers. The wording lives here once so each
 * transport asks for the same thing. `test/fixtures/narration.json` holds the same values for the
 * Python server.
 */
export const VACP_NARRATION_MAX_LENGTH = 280;

/** Description of the progress tool: one sentence before the work and one when it is done. */
export const vacpProgressGuidance =
  'Tell the person watching what you are about to do, in one short plain sentence they can read on screen. ' +
  'Call it once before your first action. Set done to true with a brief closing sentence that states what the view now shows. ' +
  'Every action also carries its own narration, so each step shows its own reason.';

/** Description of the `narration` field on every action tool: the step's own sentence. */
export const vacpNarrationGuidance =
  'One short present-tense sentence for the person watching: what this step does to the data and the view, and why, ' +
  'for example "Keeping rowing and canoe to compare the two paddle sports". ' +
  'Write a new sentence for every step. Leave out tool names, references, ids, and remarks about yourself.';

/** A sentence for the person watching, trimmed. Missing, blank, and over-long sentences are rejected. */
export function parseVacpNarration(value: unknown, field = 'narration'): string {
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string`);
  const text = value.trim();
  if (!text) throw new TypeError(`${field} requires a sentence`);
  if (text.length > VACP_NARRATION_MAX_LENGTH)
    throw new TypeError(`${field} is at most ${VACP_NARRATION_MAX_LENGTH} characters`);
  return text;
}
