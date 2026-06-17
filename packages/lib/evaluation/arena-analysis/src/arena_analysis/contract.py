from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, cast

MESSAGE_RE = re.compile(r'^## Message\s+(\d{3})\s+\((assistant|user)\)\s*$', re.MULTILINE)
ANSWER_RE = re.compile(r'^\s*#{0,3}\s*Answer\s*:', re.MULTILINE)

STRATUM_VALUES = ['SEM', 'SYN', 'PRG']
PHASE_VALUES = ['FOR', 'STR', 'EVL', 'INS', 'TERM']
OUTCOME_VALUES = ['SUC', 'FEX', 'FLA']
SHIFT_VALUES = ['LAD', 'DES', 'STA']

STRATUMS = set(STRATUM_VALUES)
PHASES = set(PHASE_VALUES)
OUTCOMES = set(OUTCOME_VALUES)
SHIFTS = set(SHIFT_VALUES)
STRATUM_RANK = {'PRG': 0, 'SYN': 1, 'SEM': 2}

TURN_KEYS = {'turn', 'stratum', 'phase', 'outcome', 'shift', 'notes'}

RESPONSE_SCHEMA: dict[str, Any] = {
    'name': 'interaction_turns_wrapper',
    'strict': True,
    'schema': {
        'type': 'object',
        'additionalProperties': False,
        'properties': {
            'turns': {
                'type': 'array',
                'items': {
                    'type': 'object',
                    'additionalProperties': False,
                    'properties': {
                        'turn': {'type': 'integer'},
                        'stratum': {'type': 'string', 'enum': STRATUM_VALUES},
                        'phase': {'type': 'string', 'enum': PHASE_VALUES},
                        'outcome': {'type': 'string', 'enum': OUTCOME_VALUES},
                        'shift': {
                            'anyOf': [
                                {'type': 'string', 'enum': SHIFT_VALUES},
                                {'type': 'null'},
                            ]
                        },
                        'notes': {'type': 'string'},
                    },
                    'required': ['turn', 'stratum', 'phase', 'outcome', 'shift', 'notes'],
                },
            }
        },
        'required': ['turns'],
    },
}


@dataclass(frozen=True, slots=True)
class TranscriptMeta:
    assistant_turns: list[int]
    last_answer_turn: int | None
    is_stub: bool
    stub_status: str | None


def parse_meta(transcript_text: str) -> TranscriptMeta:
    matches = list(MESSAGE_RE.finditer(transcript_text))
    assistant_turns: list[int] = []
    answer_turns: list[int] = []

    for index, match in enumerate(matches):
        if match.group(2) != 'assistant':
            continue
        turn = int(match.group(1))
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(transcript_text)
        chunk = transcript_text[start:end]
        assistant_turns.append(turn)
        if ANSWER_RE.search(chunk):
            answer_turns.append(turn)

    stub_status = None
    if 'status: `missing_session_id`' in transcript_text:
        stub_status = 'missing_session_id'
    elif 'status: `no_messages`' in transcript_text:
        stub_status = 'no_messages'
    elif len(assistant_turns) == 0:
        stub_status = 'no_assistant_turns'

    return TranscriptMeta(
        assistant_turns=assistant_turns,
        last_answer_turn=answer_turns[-1] if answer_turns else None,
        is_stub=stub_status is not None,
        stub_status=stub_status,
    )


def build_stub_turn(meta: TranscriptMeta) -> dict[str, Any]:
    status = meta.stub_status or 'stub'
    return {
        'turn': 0,
        'stratum': 'SYN',
        'phase': 'TERM',
        'outcome': 'FLA',
        'shift': None,
        'notes': f'Transcript status is {status}. No assistant messages were available to classify.',
    }


def normalize_shifts(turns: Any) -> Any:
    if not isinstance(turns, list):
        return turns
    if not all(isinstance(item, dict) for item in turns):
        return turns
    if not all(isinstance(item.get('turn'), int) for item in turns):
        return turns

    normalized = [dict(item) for item in turns]
    normalized.sort(key=lambda item: item['turn'])

    for index, item in enumerate(normalized):
        if index == 0:
            item['shift'] = None
            continue

        previous = normalized[index - 1]
        previous_outcome = previous.get('outcome')
        previous_stratum = previous.get('stratum')
        current_stratum = item.get('stratum')
        if previous_outcome in {'FEX', 'FLA'} and previous_stratum in STRATUM_RANK and current_stratum in STRATUM_RANK:
            previous_rank = STRATUM_RANK[previous_stratum]
            current_rank = STRATUM_RANK[current_stratum]
            if current_rank == previous_rank:
                item['shift'] = 'STA'
            elif current_rank > previous_rank:
                item['shift'] = 'LAD'
            else:
                item['shift'] = 'DES'
        else:
            item['shift'] = None

    return normalized


def validate_turns(turns: Any, meta: TranscriptMeta) -> list[str]:
    errors: list[str] = []
    if not isinstance(turns, list):
        return ['top-level value is not an array']

    if meta.is_stub:
        expected_turn = build_stub_turn(meta)
        if turns != [expected_turn]:
            return ['stub transcript requires one synthetic terminal state']
        return []

    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(turns):
        if not isinstance(item, dict):
            errors.append(f'item[{index}] is not an object')
            continue
        row = cast(dict[str, Any], item)
        if set(row.keys()) != TURN_KEYS:
            errors.append(f'item[{index}] keys mismatch')

        turn = row.get('turn')
        stratum = row.get('stratum')
        phase = row.get('phase')
        outcome = row.get('outcome')
        shift = row.get('shift')
        notes = row.get('notes')

        if type(turn) is not int:
            errors.append(f'item[{index}].turn must be int')
        if not isinstance(stratum, str):
            errors.append(f'item[{index}].stratum must be string')
        elif stratum not in STRATUMS:
            errors.append(f'item[{index}].stratum invalid: {stratum!r}')
        if not isinstance(phase, str):
            errors.append(f'item[{index}].phase must be string')
        elif phase not in PHASES:
            errors.append(f'item[{index}].phase invalid: {phase!r}')
        if not isinstance(outcome, str):
            errors.append(f'item[{index}].outcome must be string')
        elif outcome not in OUTCOMES:
            errors.append(f'item[{index}].outcome invalid: {outcome!r}')
        if shift is not None:
            if not isinstance(shift, str):
                errors.append(f'item[{index}].shift must be string or null')
            elif shift not in SHIFTS:
                errors.append(f'item[{index}].shift invalid: {shift!r}')
        if not isinstance(notes, str) or not notes.strip():
            errors.append(f'item[{index}].notes must be non-empty string')
        normalized.append(row)

    if errors:
        return errors

    turn_ids = [item['turn'] for item in normalized]
    if turn_ids != sorted(turn_ids):
        errors.append('turn values are not sorted')
    if len(set(turn_ids)) != len(turn_ids):
        errors.append('turn values contain duplicates')

    expected = meta.assistant_turns
    if set(turn_ids) != set(expected):
        missing = sorted(set(expected) - set(turn_ids))
        extra = sorted(set(turn_ids) - set(expected))
        if missing:
            errors.append(f'missing assistant turns: {missing}')
        if extra:
            errors.append(f'unexpected turns: {extra}')

    by_turn = {item['turn']: item for item in normalized}
    for index, item in enumerate(normalized):
        shift = item['shift']
        if index == 0:
            if shift is not None:
                errors.append('first item shift must be null')
            continue

        previous = normalized[index - 1]
        if previous['outcome'] in {'FEX', 'FLA'}:
            previous_rank = STRATUM_RANK[previous['stratum']]
            current_rank = STRATUM_RANK[item['stratum']]
            expected_shift = (
                'STA' if current_rank == previous_rank else ('LAD' if current_rank > previous_rank else 'DES')
            )
            if shift != expected_shift:
                errors.append(f'turn {item["turn"]} shift mismatch: expected {expected_shift}, got {shift!r}')
        elif shift is not None:
            errors.append(f'turn {item["turn"]} shift must be null when previous outcome is {previous["outcome"]}')

    if meta.last_answer_turn is not None:
        answer_item = by_turn.get(meta.last_answer_turn)
        if answer_item is None:
            errors.append(f'answer turn {meta.last_answer_turn} missing')
        elif answer_item.get('phase') != 'TERM':
            errors.append(f'answer turn {meta.last_answer_turn} must have phase TERM')

    terminal_turns = set()
    if meta.last_answer_turn is not None:
        terminal_turns.add(meta.last_answer_turn)
    if meta.assistant_turns:
        terminal_turns.add(meta.assistant_turns[-1])
    for item in normalized:
        if item['phase'] == 'TERM' and item['turn'] not in terminal_turns:
            expected = sorted(terminal_turns)
            errors.append(f'turn {item["turn"]} has phase TERM outside terminal turns {expected}')

    return errors
