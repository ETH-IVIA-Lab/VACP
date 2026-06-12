import asyncio
import json
from pathlib import Path
from typing import Any

from arena_analysis.runs import Job
from arena_analysis.states import (
    Options,
    build_chat_messages,
    dump,
    process,
    verify_jobs,
)


class FakeClassifier:
    async def classify(self, prompt: str, transcript_text: str) -> list[dict[str, Any]]:
        assert prompt == 'state prompt'
        assert '## Message 001 (assistant)' in transcript_text
        return [
            {
                'turn': 1,
                'stratum': 'SEM',
                'phase': 'TERM',
                'outcome': 'SUC',
                'shift': 'STA',
                'notes': 'Answers the task.',
            }
        ]


async def no_sleep(_: float) -> None:
    return None


def make_job(tmp_path: Path) -> Job:
    run_dir = tmp_path / 'run'
    run_dir.mkdir()
    transcript = run_dir / 'transcript.md'
    transcript.write_text('## Message 001 (assistant)\nAnswer:\nDone.\n', encoding='utf-8')
    run_json = run_dir / 'run.json'
    run_json.write_text(json.dumps({'ok': True}), encoding='utf-8')
    return Job(transcript=transcript, run_json=run_json, states=run_dir / 'states.json')


def test_process_state_job_uses_injected_classifier_and_writes_valid_states(tmp_path: Path) -> None:
    job = make_job(tmp_path)

    result = asyncio.run(
        process(
            job,
            classifier=FakeClassifier(),
            prompt='state prompt',
            options=Options(overwrite=True),
            sleep=no_sleep,
        )
    )

    assert result.ok is True
    assert result.kind == 'classified'
    assert json.loads(job.states.read_text(encoding='utf-8')) == [
        {
            'turn': 1,
            'stratum': 'SEM',
            'phase': 'TERM',
            'outcome': 'SUC',
            'shift': None,
            'notes': 'Answers the task.',
        }
    ]
    assert verify_jobs([job]).failures == []


def test_dump_input_payloads_writes_exact_two_message_request(tmp_path: Path) -> None:
    job = make_job(tmp_path)
    output = tmp_path / 'inputs.jsonl'

    dump(output, [job], prompt='state prompt', model='gpt-5.2')

    row = json.loads(output.read_text(encoding='utf-8'))
    assert row['model'] == 'gpt-5.2'
    assert row['messages'] == build_chat_messages('state prompt', job.transcript.read_text(encoding='utf-8'))
