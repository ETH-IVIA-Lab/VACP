from __future__ import annotations

import json
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass(frozen=True, slots=True)
class Job:
    transcript: Path
    run_json: Path
    states: Path


@dataclass(frozen=True, slots=True)
class Selection:
    include_attempts: bool = False
    include_failed_runs: bool = False


@dataclass(frozen=True, slots=True)
class Discovery:
    jobs: list[Job]
    skipped: dict[str, int] = field(default_factory=dict)


TranscriptFinder = Callable[[Path], Iterable[Path]]
RunJsonLoader = Callable[[Path], Mapping[str, Any]]


def find_transcripts(runs_root: Path) -> Iterable[Path]:
    return sorted(runs_root.rglob('transcript.md'))


def load_run_json(path: Path) -> Mapping[str, Any]:
    data = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(data, dict):
        raise ValueError(f'run JSON is not an object: {path}')
    return data


def discover_jobs(
    runs_root: Path,
    *,
    selection: Selection | None = None,
    transcript_finder: TranscriptFinder = find_transcripts,
    run_json_loader: RunJsonLoader = load_run_json,
) -> Discovery:
    selection = selection or Selection()
    jobs: list[Job] = []
    skipped = {
        'attempts': 0,
        'missing_run_json': 0,
        'bad_run_json': 0,
        'run_not_ok': 0,
    }

    for transcript in transcript_finder(runs_root):
        if not selection.include_attempts and 'attempts' in transcript.parts:
            skipped['attempts'] += 1
            continue

        run_json = transcript.with_name('run.json')
        if not run_json.exists():
            skipped['missing_run_json'] += 1
            continue

        try:
            run_data = run_json_loader(run_json)
        except Exception:
            skipped['bad_run_json'] += 1
            continue

        if not selection.include_failed_runs and run_data.get('ok') is not True:
            skipped['run_not_ok'] += 1
            continue

        jobs.append(Job(transcript=transcript, run_json=run_json, states=transcript.with_name('states.json')))

    return Discovery(jobs=jobs, skipped=skipped)
