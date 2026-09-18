from arena_analysis.contract import build_stub_turn, normalize_shifts, parse_meta, validate_turns


def test_validate_turns_matches_assistant_turns_and_final_answer() -> None:
    transcript = """## Message 001 (user)
Start.

## Message 002 (assistant)
I will inspect the view.

## Message 003 (assistant)
Answer:
Done.
"""
    meta = parse_meta(transcript)

    turns = normalize_shifts(
        [
            {
                'turn': 2,
                'stratum': 'PRG',
                'phase': 'FOR',
                'outcome': 'FEX',
                'shift': 'STA',
                'notes': 'Inspects the current view.',
            },
            {
                'turn': 3,
                'stratum': 'SEM',
                'phase': 'TERM',
                'outcome': 'SUC',
                'shift': None,
                'notes': 'Provides the answer.',
            },
        ]
    )

    assert meta.assistant_turns == [2, 3]
    assert meta.last_answer_turn == 3
    assert turns[0]['shift'] is None
    assert turns[1]['shift'] == 'LAD'
    assert validate_turns(turns, meta) == []


def test_validate_turns_rejects_non_terminal_answer_phase() -> None:
    transcript = """## Message 001 (assistant)
Answer:
Done.
"""
    errors = validate_turns(
        [
            {
                'turn': 1,
                'stratum': 'SEM',
                'phase': 'EVL',
                'outcome': 'SUC',
                'shift': None,
                'notes': 'Answers without a terminal phase.',
            }
        ],
        parse_meta(transcript),
    )

    assert 'answer turn 1 must have phase TERM' in errors


def test_validate_turns_reports_malformed_enum_values() -> None:
    transcript = """## Message 001 (assistant)
Answer:
Done.
"""
    errors = validate_turns(
        [
            {
                'turn': 1,
                'stratum': [],
                'phase': [],
                'outcome': [],
                'shift': [],
                'notes': 'Malformed enum values should report validation errors.',
            }
        ],
        parse_meta(transcript),
    )

    assert 'item[0].stratum must be string' in errors
    assert 'item[0].phase must be string' in errors
    assert 'item[0].outcome must be string' in errors
    assert 'item[0].shift must be string or null' in errors


def test_validate_turns_rejects_boolean_turn_values() -> None:
    transcript = """## Message 001 (assistant)
Answer:
Done.
"""
    errors = validate_turns(
        [
            {
                'turn': True,
                'stratum': 'SEM',
                'phase': 'TERM',
                'outcome': 'SUC',
                'shift': None,
                'notes': 'Boolean turns are invalid JSON state values.',
            }
        ],
        parse_meta(transcript),
    )

    assert 'item[0].turn must be int' in errors


def test_validate_turns_allows_answer_and_final_stop_term() -> None:
    transcript = """## Message 001 (assistant)
Answer:
Done.

## Message 002 (assistant)
"""
    errors = validate_turns(
        [
            {
                'turn': 1,
                'stratum': 'SEM',
                'phase': 'TERM',
                'outcome': 'SUC',
                'shift': None,
                'notes': 'Answers the task.',
            },
            {
                'turn': 2,
                'stratum': 'PRG',
                'phase': 'TERM',
                'outcome': 'SUC',
                'shift': None,
                'notes': 'Session stops.',
            },
        ],
        parse_meta(transcript),
    )

    assert errors == []


def test_validate_turns_rejects_term_outside_terminal_turns() -> None:
    transcript = """## Message 001 (assistant)
Inspect.

## Message 002 (assistant)
Answer:
Done.
"""
    errors = validate_turns(
        [
            {
                'turn': 1,
                'stratum': 'SEM',
                'phase': 'TERM',
                'outcome': 'SUC',
                'shift': None,
                'notes': 'Terminates too early.',
            },
            {
                'turn': 2,
                'stratum': 'SEM',
                'phase': 'TERM',
                'outcome': 'SUC',
                'shift': None,
                'notes': 'Answers the task.',
            },
        ],
        parse_meta(transcript),
    )

    assert 'turn 1 has phase TERM outside terminal turns [2]' in errors


def test_validate_turns_rejects_term_before_final_turn_without_answer() -> None:
    transcript = """## Message 001 (assistant)
Inspect.

## Message 002 (assistant)
Still inspecting.
"""
    errors = validate_turns(
        [
            {
                'turn': 1,
                'stratum': 'SEM',
                'phase': 'TERM',
                'outcome': 'SUC',
                'shift': None,
                'notes': 'Terminates before the final turn.',
            },
            {
                'turn': 2,
                'stratum': 'SEM',
                'phase': 'FOR',
                'outcome': 'SUC',
                'shift': None,
                'notes': 'Continues after the premature terminal turn.',
            },
        ],
        parse_meta(transcript),
    )

    assert 'turn 1 has phase TERM outside terminal turns [2]' in errors


def test_validate_turns_rejects_empty_stub_states() -> None:
    transcript = """# Transcript

## Metadata

- status: `missing_session_id`

## Note

run.json does not contain a sessionID for this job.
"""
    meta = parse_meta(transcript)

    assert meta.is_stub is True
    assert meta.stub_status == 'missing_session_id'
    assert validate_turns([], meta) == ['stub transcript requires one synthetic terminal state']


def test_validate_turns_accepts_synthetic_stub_state() -> None:
    transcript = """# Transcript

## Metadata

- status: `no_messages`
"""
    meta = parse_meta(transcript)

    assert validate_turns([build_stub_turn(meta)], meta) == []
