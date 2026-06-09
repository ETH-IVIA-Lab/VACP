from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol, cast

from openai import AsyncOpenAI

from arena_analyis.contract import RESPONSE_SCHEMA, normalize_shifts, parse_meta, validate_turns
from arena_analyis.runs import Job

TranscriptReader = Callable[[Path], str]
StatesReader = Callable[[Path], Any]
StatesWriter = Callable[[Path, list[dict[str, Any]]], None]
ProgressCallback = Callable[[int, int, int], None]
AsyncSleeper = Callable[[float], Awaitable[None]]


class Classifier(Protocol):
    async def classify(self, prompt: str, transcript_text: str) -> list[dict[str, Any]]: ...


@dataclass(frozen=True, slots=True)
class Retry:
    max_attempts: int = 3
    base_delay_seconds: float = 2.0
    max_delay_seconds: float = 10.0

    def delay_for_attempt(self, attempt: int) -> float:
        return min(self.base_delay_seconds * attempt, self.max_delay_seconds)


@dataclass(frozen=True, slots=True)
class Options:
    overwrite: bool = False
    retry: Retry = field(default_factory=Retry)


@dataclass(frozen=True, slots=True)
class Result:
    job: Job
    ok: bool
    kind: str
    attempts: int
    error: str | None = None


@dataclass(frozen=True, slots=True)
class Verification:
    checked: int
    missing: int
    failures: list[str]


class OpenAIClassifier:
    def __init__(
        self,
        *,
        model: str,
        base_url: str,
        api_key: str,
        timeout_seconds: float,
        client: AsyncOpenAI | None = None,
    ) -> None:
        self.model = model
        self.timeout_seconds = timeout_seconds
        self._client = client or AsyncOpenAI(base_url=base_url, api_key=api_key)
        self._owns_client = client is None

    async def classify(self, prompt: str, transcript_text: str) -> list[dict[str, Any]]:
        response = await asyncio.wait_for(
            self._client.chat.completions.create(
                model=self.model,
                temperature=0,
                response_format=cast(Any, {'type': 'json_schema', 'json_schema': RESPONSE_SCHEMA}),
                messages=cast(Any, build_chat_messages(prompt, transcript_text)),
            ),
            timeout=max(1.0, self.timeout_seconds),
        )
        content = response.choices[0].message.content
        if not isinstance(content, str) or not content.strip():
            raise ValueError('empty model response')

        parsed = json.loads(content)
        if not isinstance(parsed, dict) or 'turns' not in parsed:
            raise ValueError('model response is not {"turns": [...]} object')

        turns = parsed['turns']
        if not isinstance(turns, list):
            raise ValueError('model response turns is not an array')
        return turns

    async def close(self) -> None:
        if self._owns_client:
            await self._client.close()


def read_text_file(path: Path) -> str:
    return path.read_text(encoding='utf-8', errors='replace')


def read_states_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding='utf-8'))


def write_states_json(path: Path, turns: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(turns, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def build_chat_messages(prompt: str, transcript_text: str) -> list[dict[str, str]]:
    return [
        {'role': 'system', 'content': prompt},
        {'role': 'user', 'content': transcript_text},
    ]


def validate_existing_state(
    job: Job,
    *,
    require_existing: bool = True,
    transcript_reader: TranscriptReader = read_text_file,
    states_reader: StatesReader = read_states_json,
) -> list[str]:
    if not job.states.exists():
        return [f'missing states.json: {job.states}'] if require_existing else []

    try:
        turns = states_reader(job.states)
    except Exception as exc:
        return [f'invalid JSON {job.states}: {exc}']

    transcript_text = transcript_reader(job.transcript)
    return validate_turns(turns, parse_meta(transcript_text))


def verify_jobs(
    jobs: Sequence[Job],
    *,
    require_complete: bool = False,
    transcript_reader: TranscriptReader = read_text_file,
    states_reader: StatesReader = read_states_json,
) -> Verification:
    failures: list[str] = []
    checked = 0
    missing = 0

    for job in jobs:
        if not job.states.exists():
            missing += 1
            if require_complete:
                failures.append(f'missing states.json: {job.states}')
            continue

        checked += 1
        errors = validate_existing_state(
            job,
            require_existing=True,
            transcript_reader=transcript_reader,
            states_reader=states_reader,
        )
        failures.extend(f'{job.states}: {error}' for error in errors)

    return Verification(checked=checked, missing=missing, failures=failures)


async def process(
    job: Job,
    *,
    classifier: Classifier,
    prompt: str,
    options: Options | None = None,
    transcript_reader: TranscriptReader = read_text_file,
    states_reader: StatesReader = read_states_json,
    states_writer: StatesWriter = write_states_json,
    sleep: AsyncSleeper = asyncio.sleep,
) -> Result:
    options = options or Options()
    transcript_text = transcript_reader(job.transcript)
    meta = parse_meta(transcript_text)

    if job.states.exists() and not options.overwrite:
        errors = validate_existing_state(
            job,
            require_existing=True,
            transcript_reader=transcript_reader,
            states_reader=states_reader,
        )
        if errors:
            return Result(job=job, ok=False, kind='skipped_existing', attempts=0, error='; '.join(errors))
        return Result(job=job, ok=True, kind='skipped_existing', attempts=0)

    if meta.is_stub:
        states_writer(job.states, [])
        errors = validate_turns([], meta)
        if errors:
            return Result(job=job, ok=False, kind='stub', attempts=0, error='; '.join(errors))
        return Result(job=job, ok=True, kind='stub', attempts=0)

    last_error: str | None = None
    max_attempts = max(1, options.retry.max_attempts)
    for attempt in range(1, max_attempts + 1):
        try:
            turns = await classifier.classify(prompt, transcript_text)
            normalized_turns = normalize_shifts(turns)
            errors = validate_turns(normalized_turns, meta)
            if errors:
                raise ValueError('; '.join(errors))
            states_writer(job.states, normalized_turns)
            return Result(job=job, ok=True, kind='classified', attempts=attempt)
        except Exception as exc:
            last_error = f'attempt {attempt}: {exc}'
            if attempt < max_attempts:
                await sleep(options.retry.delay_for_attempt(attempt))

    return Result(job=job, ok=False, kind='classified', attempts=max_attempts, error=last_error)


async def generate(
    jobs: Sequence[Job],
    *,
    classifier: Classifier,
    prompt: str,
    concurrency: int = 8,
    options: Options | None = None,
    progress: ProgressCallback | None = None,
) -> list[Result]:
    options = options or Options()
    semaphore = asyncio.Semaphore(max(1, concurrency))

    async def bounded(job: Job) -> Result:
        async with semaphore:
            return await process(
                job,
                classifier=classifier,
                prompt=prompt,
                options=options,
            )

    tasks = [asyncio.create_task(bounded(job)) for job in jobs]
    results: list[Result] = []
    for completed, task in enumerate(asyncio.as_completed(tasks), start=1):
        result = await task
        results.append(result)
        if progress is not None:
            ok_count = sum(1 for item in results if item.ok)
            progress(completed, len(tasks), ok_count)

    return results


def dump(path: Path, jobs: Sequence[Job], *, prompt: str, model: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf-8') as handle:
        for index, job in enumerate(jobs, start=1):
            transcript_text = read_text_file(job.transcript)
            payload = {
                'call_index': index,
                'model': model,
                'source': {
                    'transcript': str(job.transcript),
                    'run_json': str(job.run_json),
                    'states': str(job.states),
                },
                'messages': build_chat_messages(prompt, transcript_text),
            }
            handle.write(json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + '\n')
