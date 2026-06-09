from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

from arena_analyis import env
from arena_analyis.paths import DEFAULT_PROMPT_FILE, DEFAULT_RUNS_ROOT
from arena_analyis.runs import Discovery, Selection, discover_jobs
from arena_analyis.states import (
    OpenAIClassifier,
    Options,
    Retry,
    dump,
    generate,
    verify_jobs,
)


def add_run_selection_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument('--runs-root', default=str(DEFAULT_RUNS_ROOT))
    parser.add_argument('--include-attempts', action='store_true')
    parser.add_argument('--include-failed-runs', action='store_true')
    parser.add_argument('--limit', type=int, default=0)


def add_prompt_arg(parser: argparse.ArgumentParser) -> None:
    parser.add_argument('--prompt-file', default=str(DEFAULT_PROMPT_FILE))


def add_model_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument('--model', default=env.model())
    parser.add_argument('--base-url', default=env.base_url())
    parser.add_argument('--api-key', default=env.api_key())


def load_prompt(path: Path) -> str:
    if not path.exists():
        raise FileNotFoundError(f'prompt file not found: {path}')
    return path.read_text(encoding='utf-8')


def load_jobs(args: argparse.Namespace) -> Discovery:
    runs_root = Path(args.runs_root)
    if not runs_root.exists():
        raise FileNotFoundError(f'runs root not found: {runs_root}')

    selection = Selection(
        include_attempts=args.include_attempts,
        include_failed_runs=args.include_failed_runs,
    )
    result = discover_jobs(runs_root, selection=selection)
    if args.limit and args.limit > 0:
        return Discovery(jobs=result.jobs[: args.limit], skipped=result.skipped)
    return result


def print_discovery(result: Discovery) -> None:
    print(f'discovered jobs: {len(result.jobs)}')
    print(f'skipped: {json.dumps(result.skipped, sort_keys=True)}')


async def command_generate_states(args: argparse.Namespace) -> int:
    print_env(args.env)
    prompt = load_prompt(Path(args.prompt_file))
    discovery = load_jobs(args)
    print_discovery(discovery)
    if not discovery.jobs:
        print('no eligible transcripts found')
        return 1

    classifier = OpenAIClassifier(
        model=args.model,
        base_url=args.base_url,
        api_key=args.api_key,
        timeout_seconds=args.timeout_seconds,
    )
    start = time.time()

    def progress(completed: int, total: int, ok_count: int) -> None:
        if completed % 25 == 0 or completed == total:
            print(f'progress: {completed}/{total} done (ok={ok_count}, fail={completed - ok_count})', flush=True)

    try:
        results = await generate(
            discovery.jobs,
            classifier=classifier,
            prompt=prompt,
            concurrency=args.maxjobs,
            options=Options(
                overwrite=args.overwrite,
                retry=Retry(
                    max_attempts=args.max_attempts,
                    base_delay_seconds=args.retry_delay_seconds,
                    max_delay_seconds=args.max_retry_delay_seconds,
                ),
            ),
            progress=progress,
        )
    finally:
        await classifier.close()

    failures = [result for result in results if not result.ok]
    verification = verify_jobs(discovery.jobs, require_complete=True)
    kind_counts: dict[str, int] = {}
    for result in results:
        kind_counts[result.kind] = kind_counts.get(result.kind, 0) + 1

    print(f'result kinds: {json.dumps(kind_counts, sort_keys=True)}')
    print(f'verified states: {verification.checked}')
    print(f'missing states: {verification.missing}')
    print(f'elapsed_seconds: {time.time() - start:.2f}')

    for failure in failures[:50]:
        print(f'- {failure.job.transcript}: {failure.error}', file=sys.stderr)
    for failure in verification.failures[:50]:
        print(f'- {failure}', file=sys.stderr)

    return 0 if not failures and not verification.failures else 1


def command_verify_states(args: argparse.Namespace) -> int:
    discovery = load_jobs(args)
    print_discovery(discovery)
    if not discovery.jobs:
        print('no eligible transcripts found')
        return 1

    start = time.time()
    verification = verify_jobs(discovery.jobs, require_complete=args.require_complete)
    print(f'verified states: {verification.checked}')
    print(f'missing states: {verification.missing}')
    print(f'elapsed_seconds: {time.time() - start:.2f}')
    if verification.failures:
        print(f'verification failures: {len(verification.failures)}', file=sys.stderr)
        for item in verification.failures[:50]:
            print(f'- {item}', file=sys.stderr)
        return 1
    return 0


def command_dump_inputs(args: argparse.Namespace) -> int:
    prompt = load_prompt(Path(args.prompt_file))
    discovery = load_jobs(args)
    print_discovery(discovery)
    if not discovery.jobs:
        print('no eligible transcripts found')
        return 1

    output = Path(args.output)
    dump(output, discovery.jobs, prompt=prompt, model=args.model)
    print(f'wrote inputs: {output}')
    return 0


def build_parser() -> argparse.ArgumentParser:
    env_info = env.load()
    parser = argparse.ArgumentParser(description='Analyze Agent Arena transcript states.')
    parser.set_defaults(env=env_info)
    subparsers = parser.add_subparsers(dest='command', required=True)

    generate = subparsers.add_parser('generate-states', help='Generate and validate states.json files.')
    add_run_selection_args(generate)
    add_prompt_arg(generate)
    add_model_args(generate)
    generate.add_argument('--maxjobs', type=int, default=8)
    generate.add_argument('--max-attempts', type=int, default=3)
    generate.add_argument('--timeout-seconds', type=float, default=600.0)
    generate.add_argument('--retry-delay-seconds', type=float, default=2.0)
    generate.add_argument('--max-retry-delay-seconds', type=float, default=10.0)
    generate.add_argument('--overwrite', action='store_true')
    generate.set_defaults(func=lambda args: asyncio.run(command_generate_states(args)))

    verify = subparsers.add_parser('verify-states', help='Validate existing states.json files.')
    add_run_selection_args(verify)
    verify.add_argument('--require-complete', action='store_true')
    verify.set_defaults(func=command_verify_states)

    dump_inputs = subparsers.add_parser('dump-inputs', help='Write the exact model input payloads as JSONL.')
    add_run_selection_args(dump_inputs)
    add_prompt_arg(dump_inputs)
    dump_inputs.add_argument('--model', default=env.model())
    dump_inputs.add_argument('--output', required=True)
    dump_inputs.set_defaults(func=command_dump_inputs)

    return parser


def print_env(info: env.Env) -> None:
    keys = ','.join(info.keys) if info.keys else 'none'
    print(f'env file: {info.path} loaded={str(info.loaded).lower()} keys={keys}')


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
