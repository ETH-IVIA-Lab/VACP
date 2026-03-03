# @vacp/agent-arena

## Purpose

Config-driven CLI for running OpenCode sessions against VACP-enabled apps and producing analysis artifacts.

It is designed for:

- running scenario suites with concurrency,
- snapshotting evidence into portable run folders,
- producing datasets and a report bundle for analysis.

## When to use

- Regression/evaluation across multiple example apps and stable routes.
- Comparing model/tool policies on the same task suite.
- Producing artifacts for analysis and reporting.

## Conceptual model

- **Scenario**: a target URL and a task.
- **Experiment**: a model configuration and tool policy.
- **Run**: one CLI invocation producing a timestamped folder under `.agent-arena/runs/`.

`agent-arena` runs many `(scenario, experiment)` jobs, collects outcomes, and snapshots the relevant OpenCode evidence so runs are self-contained.

## Minimal usage

1. Start the example gallery from repo root: `pnpm dev`
2. Install Playwright browser (once): `pnpm exec playwright install chromium`
3. Start OpenCode (default): `opencode serve --hostname=127.0.0.1 --port=4096`
4. Run an arena job:

```bash
pnpm -C packages/agent-arena start -- run
```

Common options:

- Override OpenCode directory: `--directory ..`
- Export OpenCode logs/metrics: `--export-logs --write-metrics`
- Choose output folder: `--out <path>`

## Configuration

Create `agent-arena.config.ts` in the directory you run from. It defines a flat list of runs.

Minimal example (placeholders):

```ts
import type { ArenaConfig } from '@vacp/agent-arena';

const config: ArenaConfig = {
  worktreeRoot: true,
  autoApprove: 'always',
  concurrency: { runs: 2 },
  timeouts: { promptMs: 10 * 60_000 },
  runs: [
    {
      experiment: 'provider/model (default tools)',
      model: { providerID: 'provider-id', modelID: 'model-id' },
      toolPolicy: { mode: 'all' },
      summarize: true,
      scenario: {
        id: 'example',
        url: 'http://127.0.0.1:5173/mosaic/#weather',
        task: 'Task prompt shown to the agent.',
      },
    },
  ],
};

export default config;
```

Notes:

- `agent-arena` performs a BASE_URL reachability preflight by default.
- Skip preflight only when intentionally needed: `VACP_ARENA_SKIP_PREFLIGHT=1`.

## Resume interrupted runs

```bash
pnpm -C packages/agent-arena start -- resume --run .agent-arena/runs/<runId>
```

Variants:

- Plan-only: `--dry-run`
- Also rerun failures: `--rerun-failed`

## Analyze and report

From `packages/agent-arena/`:

```bash
pnpm start -- analyze --run .agent-arena/runs/<runId>
pnpm start -- datasets --analysis .agent-arena/runs/<runId>/analysis
pnpm start -- report --analysis .agent-arena/runs/<runId>/analysis
```

Outputs include an HTML report bundle plus per-chart datasets.

## Evidence snapshot

Analysis and reporting expect a run-local OpenCode evidence snapshot under:

- `<runDir>/evidence/opencode-storage/`
- manifest: `<runDir>/evidence/opencode-storage/manifest.json`

If required evidence is missing, strict flows fail with actionable errors.

## Scenario matrix workflow

For larger suites against local examples:

1. Start examples host from repo root: `pnpm dev`
2. Ensure Playwright browser is installed: `pnpm exec playwright install chromium`
3. Run:

```bash
pnpm -C packages/agent-arena start -- run --export-logs --write-metrics --out nogit/scenario-report-matrix/<YYYY-MM-DD>
```

## Related docs

- [Evaluation](../../docs/evaluation/index.md)
- [Examples](../../docs/examples/index.md)
- [Get started](../../docs/get-started/index.md)
