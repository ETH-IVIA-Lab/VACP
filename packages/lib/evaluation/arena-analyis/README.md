# Agent Arena Analysis

`arena-analyis` validates and generates `states.json` files for Agent Arena transcripts. It reads successful non-attempt runs under `packages/lib/evaluation/agent-arena/.agent-arena/runs` by default.

From the repository root:

```bash
uv run arena-analyis verify-states
```

Existing `states.json` files are validated against the state contract. Missing state files are reported as coverage, and fail only when `--require-complete` is passed.

## Environment

The CLI loads `packages/lib/evaluation/arena-analyis/.env` before it resolves model defaults. Supported keys:

| Key | Behavior |
| --- | --- |
| `OPENAI_BASE` | OpenAI-compatible endpoint used by the local runner. |
| `OPENAI_BASE_URL` | Endpoint fallback for standard OpenAI-compatible environments. |
| `OPENAI_API_KEY` | API key passed to the OpenAI client. |
| `MODEL` | Model name. Defaults to `gpt-5.4`. |

CLI flags override loaded values:

```bash
uv run arena-analyis generate-states \
  --base-url http://localhost:8317/v1 \
  --model gpt-5.4
```

## Generate States

Run generation against the endpoint in `.env`:

```bash
uv run arena-analyis generate-states
```

Each model request contains two messages:

- `system`: the contents of `workbench/ANALYSISPROMPT.md`
- `user`: the raw `transcript.md` text

Existing `states.json` files are validated and skipped unless `--overwrite` is passed. Transcripts under `attempts/` and runs whose sibling `run.json` does not contain `ok: true` are excluded unless `--include-attempts` or `--include-failed-runs` is passed.

Use another run directory with `--runs-root`:

```bash
uv run arena-analyis verify-states \
  --runs-root packages/lib/evaluation/agent-arena/.agent-arena/runs/2026-02-11T18-54-30-684Z
```

## Dump Model Inputs

Write the exact model inputs without calling a model:

```bash
uv run arena-analyis dump-inputs \
  --limit 1 \
  --output /tmp/arena-inputs.jsonl
```

Each JSONL row contains the selected transcript paths, model name, and the exact `messages` array.
