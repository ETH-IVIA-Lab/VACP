import json
from pathlib import Path

from arena_analyis.runs import Selection, discover_jobs


def write_run(directory: Path, *, ok: bool = True) -> None:
    directory.mkdir(parents=True)
    (directory / 'transcript.md').write_text('## Message 001 (assistant)\nAnswer:\nDone.\n', encoding='utf-8')
    (directory / 'run.json').write_text(json.dumps({'ok': ok}), encoding='utf-8')


def test_discover_jobs_skips_attempts_and_failed_runs(tmp_path: Path) -> None:
    write_run(tmp_path / 'run-ok')
    write_run(tmp_path / 'attempts' / 'run-attempt')
    write_run(tmp_path / 'run-failed', ok=False)

    result = discover_jobs(tmp_path)

    assert [job.transcript.parent.name for job in result.jobs] == ['run-ok']
    assert result.skipped['attempts'] == 1
    assert result.skipped['run_not_ok'] == 1


def test_discover_jobs_can_include_attempts_and_failed_runs(tmp_path: Path) -> None:
    write_run(tmp_path / 'run-ok')
    write_run(tmp_path / 'attempts' / 'run-attempt')
    write_run(tmp_path / 'run-failed', ok=False)

    result = discover_jobs(
        tmp_path,
        selection=Selection(include_attempts=True, include_failed_runs=True),
    )

    assert [job.transcript.parent.name for job in result.jobs] == ['run-attempt', 'run-failed', 'run-ok']
