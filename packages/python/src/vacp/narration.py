"""
The agent-facing narration contract every VACP transport offers.

`packages/protocol/test/fixtures/narration.json` holds the same values for TypeScript, so the
Python server asks for the same thing as WebMCP and the AI SDK.
"""

from __future__ import annotations

NARRATION_MAX_LENGTH = 280

PROGRESS_GUIDANCE = (
    'Tell the person watching what you are about to do, in one short plain sentence they can read on screen. '
    'Call it once before your first action. Set done to true with a brief closing sentence that states what the '
    'view now shows. Every action also carries its own narration, so each step shows its own reason.'
)

NARRATION_GUIDANCE = (
    'One short present-tense sentence for the person watching: what this step does to the data and the view, '
    'and why, for example "Keeping rowing and canoe to compare the two paddle sports". '
    'Write a new sentence for every step. Leave out tool names, references, ids, and remarks about yourself.'
)


def parse_narration(value: object, *, field: str = 'narration') -> str:
    """Trim a sentence for the person. Missing, blank, and over-long sentences are rejected."""
    if not isinstance(value, str):
        raise TypeError(f'{field} must be a string')
    text = value.strip()
    if not text:
        raise ValueError(f'{field} requires a sentence')
    if len(text) > NARRATION_MAX_LENGTH:
        raise ValueError(f'{field} is at most {NARRATION_MAX_LENGTH} characters')
    return text
