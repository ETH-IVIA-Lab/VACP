# @vacp/agent-arena

## Purpose

Config-driven CLI for running OpenCode sessions against VACP-enabled apps and producing analysis artifacts.

It is designed for:

- running scenario suites with concurrency,
- exporting OpenCode session logs into each job folder,
- producing datasets and a report bundle for analysis.

## When to use

- Regression/evaluation across multiple example apps and stable routes.
- Comparing model/tool policies on the same task suite.
- Producing artifacts for analysis and reporting.

## Conceptual model

- **Scenario**: a target URL and a task.
- **Experiment**: a model configuration and tool policy.
- **Run**: one CLI invocation producing a timestamped folder under `.agent-arena/runs/`.

`agent-arena` runs many `(scenario, experiment)` jobs, collects outcomes, and stores OpenCode session exports in the job folders when `--export-logs` is enabled.

## Minimal usage

1. Start the example gallery from repo root: `pnpm dev`
2. Install Playwright browser (once): `pnpm --filter @vacp/e2e exec playwright install chromium`
3. Start OpenCode (default): `opencode serve --hostname=127.0.0.1 --port=4096`
4. Run an arena job:

```bash
pnpm -C packages/lib/evaluation/agent-arena start -- run
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
        url: 'http://127.0.0.1:5173/vgplot/#weather',
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
pnpm -C packages/lib/evaluation/agent-arena start -- resume --run .agent-arena/runs/<runId>
```

Variants:

- Plan-only: `--dry-run`
- Also rerun failures: `--rerun-failed`

## Analyze and report

From `packages/lib/evaluation/agent-arena/`:

```bash
pnpm start -- analyze --run .agent-arena/runs/<runId>
pnpm start -- datasets --analysis .agent-arena/runs/<runId>/analysis
pnpm start -- report --analysis .agent-arena/runs/<runId>/analysis
```

Outputs include an HTML report bundle plus per-chart datasets.

Pass multiple analysis folders to produce one merged report over repeated runs:

```bash
pnpm start -- report \
  --analysis .agent-arena/runs/<runA>/analysis .agent-arena/runs/<runB>/analysis \
  --out .agent-arena/reports/<studyId>
```

The report loader merges rows at analysis time. Each run keeps its `run_id`. Charts use one preferred row per `(model, run_id, experiment, scenario)` group.

Merged HTML reports include an Individual Runs section with source summaries, a run x experiment matrix, task-level run strips, and the final retained-row ledger.

## OpenCode exports

Analysis and reporting read the OpenCode session export written for each job:

- `<jobDir>/messages.json`
- manifest: `<runDir>/analysis/opencode-export-manifest.json`

Run with `--export-logs` when a run should support later analysis. If a job has a session id but no `messages.json`, analysis fails with the missing job path.

## Scenario matrix workflow

For larger suites against local examples:

1. Start examples host from repo root: `pnpm dev`
2. Ensure Playwright browser is installed: `pnpm --filter @vacp/e2e exec playwright install chromium`
3. Run:

```bash
pnpm -C packages/lib/evaluation/agent-arena start -- run --export-logs --write-metrics --out nogit/scenario-report-matrix/<YYYY-MM-DD>
```

## Related docs

- [Evaluation](../../../../docs/evaluation/index.md)
- [Examples](../../../../docs/examples/index.md)
- [Get started](../../../../docs/get-started/index.md)
