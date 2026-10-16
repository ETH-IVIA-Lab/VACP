"""
The agent-facing narration contract every VACP transport offers.

`packages/protocol/test/fixtures/narration.json` holds the same values for TypeScript, so the
Python server asks for the same thing as WebMCP and the AI SDK. Lengths count code points.
"""

from __future__ import annotations

NARRATION_MAX_LENGTH = 280

PROGRESS_GUIDANCE = (
    'Tell the person watching what you are about to do, in one short plain sentence they can read on screen. '
    'Call it once before your first action. Set done to true with a brief closing sentence that states what the '
    'view now shows. Every action also carries its own narration, so each step shows its own reason.'
)

PROGRESS_FIELDS = {
    'message': 'One plain sentence for the person.',
    'done': 'True when this message closes the current task.',
}

NARRATION_GUIDANCE = (
    'One short present-tense sentence for the person watching: what this step does to the data and the view, '
    'and why, for example "Keeping rowing and canoe to compare the two paddle sports". '
    'Write a new sentence for every step. Leave out tool names, references, ids, and remarks about yourself.'
)


# Unicode White_Space, the set every transport trims. `str.strip()` and JavaScript `trim()` each differ.
WHITESPACE = (
    '\t\n\x0b\x0c\r \x85\xa0\u1680'
    '\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a'
    '\u2028\u2029\u202f\u205f\u3000'
)


def parse_narration(value: object, *, field: str = 'narration') -> str:
    """Trim a sentence for the person. Missing, blank, and over-long sentences are rejected."""
    if not isinstance(value, str):
        raise TypeError(f'{field} must be a string')
    text = value.strip(WHITESPACE)
    if not text:
        raise ValueError(f'{field} requires a sentence')
    if len(text) > NARRATION_MAX_LENGTH:
        raise ValueError(f'{field} is at most {NARRATION_MAX_LENGTH} characters')
    return text
