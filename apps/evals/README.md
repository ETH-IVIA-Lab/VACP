# @vacp/evals

Agent evals for VACP. Each run puts an agent on an example page, sends it an analyst's request, and grades what it left behind: the VACP state of the page, its rendered text, and its reply. Every run also records tokens, cost, latency, tool calls, and how much of the graph the agent read.

A **condition** is one arm of the experiment: the agent loop, the tools it reaches the page with, and its instructions. A **flow** is one condition on one model. Both stay fixed within a flow, so a change to VACP shows up as a change in its numbers.

```bash
make build-libs browser-install       # built @vacp packages and Playwright's Chromium
pnpm --filter @vacp/evals eval audit  # reference solutions pass, a silent agent fails
pnpm --filter @vacp/evals eval run --approve-eval
pnpm --filter @vacp/evals eval summary
```

`run` serves the gallery from source on `127.0.0.1:4480`, runs the 32 scenarios three times each in the `webmcp` condition on `gpt-6-luna`, and prints the flow's status table. Rows land in `results/condition=webmcp/model=gpt-6-luna/variant=baseline/` as each run finishes, so an interrupted run resumes where it stopped.

## Models

Models go through [AI SDK](https://ai-sdk.dev) providers declared in `evals.config.ts`. The default provider is an OpenAI-compatible endpoint read from the environment or from `apps/evals/.env`:

| Variable          | Default                                              |
| ----------------- | ---------------------------------------------------- |
| `OPENAI_BASE_URL` | `http://localhost:8317/v1`                           |
| `OPENAI_API_KEY`  | `default`                                            |
| `OPENAI_MODEL`    | `gpt-6-luna`, the model `run` uses without `--model` |

`--model` takes a key from `models`: `gpt-6-luna`, `claude-sonnet-5-5`, `claude-opus-5-5`, or `claude-haiku-4-5`. A model with a `price` gets a cost column. Prices are first-party list prices per million tokens, so a gateway that bills differently needs its own rate card. A model without a price reports `no price`, never zero. Add a model or a provider in `evals.config.ts`:

```ts
providers: { anthropic: { kind: 'anthropic', apiKey: env.ANTHROPIC_API_KEY } },
models: { 'anthropic.claude-sonnet-5-5': { provider: 'anthropic', id: 'claude-sonnet-5-5', price: { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 } } },
```

The runner fails a run whose response names a different model than the one requested. Snapshot suffixes and provider prefixes such as `local/gpt-6-luna` count as the same model.

## Conditions

`--condition` picks a condition by its key in `evals.config.ts`, which also names its results partition:

| Condition     | Agent loop                                          | Tools the model sees                                       |
| ------------- | --------------------------------------------------- | ---------------------------------------------------------- |
| `webmcp`      | AI SDK `generateText`, one model call at a time     | The page's WebMCP catalog, read again before every call    |
| `vacp-agent`  | `createVacpToolLoopAgent` from `@vacp/agent-ai-sdk` | The VACP bridge tools                                      |
| `claude-code` | Claude Code through AI SDK `HarnessAgent`           | The VACP bridge tools. Built-in tools are filtered out     |
| `codex`       | Codex through AI SDK `HarnessAgent`                 | The VACP bridge tools beside Codex's shell and patch tools |
| `opencode`    | OpenCode through AI SDK `HarnessAgent`              | The VACP bridge tools. Built-in tools are filtered out     |
| `pi`          | Pi through AI SDK `HarnessAgent`                    | The VACP bridge tools. Built-in tools are filtered out     |
| `oracle`      | Each turn's reference solution                      | Scenario actions through the bridge                        |
| `none`        | No agent, the control                               | None                                                       |

The VACP bridge tools are `vacp_observe`, `vacp_capabilities`, `vacp_state`, `vacp_execute`, and `vacp_progress` from the [tool contract](../../docs/api/agent-tools.md), the same tools the Python MCP server gives an external agent. `vacp-agent` uses the product agent's own instructions and temperature, with the suite's `run.maxSteps` model calls per turn. Every other agent condition uses the instructions of a browser host's assistant.

To add a condition, implement `Condition` from `src/ports.ts` and register it under a new key in `conditions`. An `agent` condition starts once per flow with the flow's model and returns a session whose `description` records its loop, instructions, tools, and settings. Each run's conversation receives the page as an `AgentPage` and passes the run's AI SDK `telemetry` to every AI SDK call, which fills the run's transcript, steps, usage, and tool timings. An `oracle` condition plays reference solutions and a `control` condition does nothing, and `eval audit` runs every condition of those two kinds.

### Harness conditions

The `claude-code`, `codex`, `opencode`, and `pi` conditions run [AI SDK harnesses](https://ai-sdk.dev/docs/ai-sdk-harnesses): complete agent runtimes behind one `HarnessAgent` interface. Each keeps its own system prompt, loop, session, and compaction. The eval gives it the VACP bridge tools as host-executed AI SDK tools, which run in the eval process against the page. `HarnessAgent` holds a turn's tools fixed, and the bridge tools stay fixed while VACP discloses actions, so a harness finds new actions through `vacp_observe`.

Each harness reaches the flow's model through the provider's endpoint in its own protocol:

| Condition     | Protocol                                       | Configuration                                                           |
| ------------- | ---------------------------------------------- | ----------------------------------------------------------------------- |
| `claude-code` | Anthropic Messages at the endpoint's origin    | `ANTHROPIC_BASE_URL` and `ANTHROPIC_API_KEY`                            |
| `codex`       | OpenAI Responses                               | `OPENAI_BASE_URL` and `OPENAI_API_KEY`, with the model's context window |
| `opencode`    | OpenAI Responses through its `openai` provider | `OPENAI_BASE_URL` and `OPENAI_API_KEY`                                  |
| `pi`          | OpenAI chat completions                        | A registered `eval` provider with the model's id and context window     |

Runtime settings go to the condition's factory in `evals.config.ts`, for example `claudeCodeCondition({ effort: 'medium' })` or `codexCondition({ reasoningEffort: 'high' })`. `harnessCondition` wraps any other `@ai-sdk/harness-*` adapter.

A harness runs in a `LocalSandbox` on this machine, one per conversation, under `~/.cache/vacp-evals/<condition>` or the suite's `workspaces` directory. The sandbox gives the runtime its own `HOME`, so each runtime installs once and reads none of your agent settings, credentials, or MCP servers. Commands run as your user. Codex's adapter cannot filter built-in tools, so Codex keeps a shell that runs outside any isolation. Bootstraps run `pnpm install`, so the sandbox directory must sit outside every pnpm workspace, and `LocalSandbox` refuses one inside.

## Scenarios

A scenario is a request on one page, the checks that decide it, a reference solution, and the reason it is hard:

```ts
defineScenario({
  id: 'athletes/male-top-medal-share',
  page: athletes,
  tags: ['select', 'ranking'],
  source: 'synthesized',
  why: 'The share must be computed within male athletes, and rowing sits less than a point behind.',
  turns: [
    {
      say: 'Among male athletes, which sport has the highest medalist share? Show only that sport, and tell me the share and how many athletes it covers.',
      expect: [
        state(cohort, 'sex', equals('male')),
        state(cohort, 'sports', sameMembers(['gymnastics'])),
        mentions('gymnastics'),
        mentions(26.3, { tolerance: 0.1 }),
      ],
      oracle: {
        steps: [act('cohort.set_sex', { sex: 'male' }), act('cohort.set_sports', { sports: ['gymnastics'] })],
        answer: 'Gymnastics: 30 of its 114 male athletes won a medal, a 26.3% share.',
      },
    },
  ],
  gold: [{ sql: `select sport, ... from {athletes} ...`, row: { sport: 'gymnastics', pct: 26.3, n: 114 } }],
}),
```

- `tags[0]` is the capability: `filter`, `select`, `point`, `control`, `setup`, `question`, `decline`, or `follow-up`. The split and the report group by it.
- Checks come from `src/core/checks.ts`, and their assertions from `src/core/assertions.ts`: each scores a value between 0 and 1. `state(ref, path, assertion)` reads VACP state after the turn, `view(selector, assertion)` reads rendered text, `mentions(value)` reads the reply, and `unchanged(ref)`, `restored(ref)`, and `readOnly()` guard side effects. `unchanged` compares the state with the start of the turn, `restored` compares it with the start of the run, and `readOnly` fails when the agent completed any execution that is not a read or a query. Checks are gates unless their assertion is `.soft()`. A check's label is unique within its turn, and a soft check's label, which names its metric, is unique within the scenario.
- `act(name, params)` names an action by local name or contract. The runner resolves it against the live graph, so source hashes stay out of scenarios.
- `setup` applies actions as a system actor before the first turn. Each turn's checks run after its reply, so a conversation checks every step.
- `gold` rows are derived from the page's raw data files by DuckDB, never from a model's output.

`pnpm --filter @vacp/evals eval inspect '/vega-lite/#airports'` lists a page's live actions and state refs while you write checks. `eval inputs` prints every scenario as markdown for review.

## What a run records

Results are [Hive-partitioned](https://duckdb.org/docs/data/partitioning/hive_partitioning) by condition, model, and variant. Conditions that call no model record `model=none`.

```
results/condition=<id>/model=<key>/
  flow.json                  model id, reps, split, price, eval digest
  variant=baseline/          then variant=v1, variant=v2, ... for hillclimb rounds
    results.jsonl            one row per (scenario, rep)
    errors.jsonl             runs that produced nothing to grade
    invocations.jsonl        each invocation: condition description, model, VACP commit and diff digest, settings, tracing
    spans.jsonl              OpenTelemetry spans of every run, one per line
    traces/<id>_rep<k>.json  the transcript: messages, tool calls, and results
    grading/<id>_rep<k>.json what the checks read: replies, state, executions, rendered text
    screenshots/<id>_rep<k>.png
```

One glob reads every run, with the partitions as columns:

```sql
select condition, model, variant, avg(grade.pass) as pass, median(read_chars) as read_chars
from read_json('apps/evals/results/**/results.jsonl', hive_partitioning = true)
group by all order by all;
```

Each row carries `grade` with four binary metrics: `pass` requires every gate, and `state`, `answer`, and `guard` report each kind of check, or `null` when the scenario has none of that kind. `explanation` quotes what each failing check observed, and `checks` holds every check's result. `trace_id` names the run's trace in `spans.jsonl`, and `invocation` names the invocation that ran it.

The measurements share one definition across conditions:

| Field                                      | What it measures                                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `usage`                                    | Billed tokens: non-cached `input`, `output`, `cache_read`, and `cache_write`                                                 |
| `latency_s`                                | Wall-clock time of the conversation's turns, without setup or grading                                                        |
| `model_calls`, `tool_calls`, `tool_errors` | Model calls, tool calls, and calls that threw or returned a failed VACP envelope                                             |
| `read_chars`                               | Characters returned by graph and state reads                                                                                 |
| `catalog_changes`                          | How often the tool list changed within the run, which rewrites the prompt cache. `null` when the condition's tools are fixed |
| `action_ms`                                | Median time of the agent's executions from accepted to settled, as the page runtime timed them                               |
| `served_model`                             | The model the provider reported for the last model call                                                                      |

## Tracing

Every run is one [OpenTelemetry](https://opentelemetry.io/) trace. The runner opens an `eval.run` span with the run's condition, model, variant, scenario, rep, split, and capability, and an `eval.turn` span per turn. Conditions pass the run's AI SDK telemetry to every AI SDK call: `generateText` in `webmcp`, `ToolLoopAgent` in `vacp-agent`, and `HarnessAgent` in the harness conditions. [`@ai-sdk/otel`](https://ai-sdk.dev/docs/ai-sdk-core/telemetry) then reports each call as [GenAI semantic convention](https://opentelemetry.io/docs/specs/semconv/gen-ai/) spans under the turn:

```
eval.run athletes/female-tall-young    vacp.eval.condition, .model, .variant, .scenario, .rep, .grade.pass, ...
└─ eval.turn                           vacp.eval.turn
   ├─ invoke_agent gpt-6-luna          ai.harness <model> in harness conditions, gen_ai.agent.name (the condition), gen_ai.usage.*
   │  └─ step 1                        one per model call
   │     ├─ chat gpt-6-luna            usage and finish reason
   │     └─ execute_tool vacp_execute  gen_ai.execute_tool.duration in seconds
   └─ vacp.execute cohort.set_sex      the page runtime's execution, with its phases as events
```

The `vacp.execute` spans come from the page runtime's own execution stream, so they time VACP from `accepted` through `prepared` and `running` to the terminal phase, the same way for every condition. The same telemetry fills the run's transcript and the row's usage, model calls, and tool timings, so every condition is measured by one definition. A call's total usage decides the row when a harness reports step usage that does not add up to it.

`HarnessAgent` opens a step when the harness streams its first part and reports each tool after it returns. In harness conditions, `chat` spans and step times leave out the model's time to first output, and `execute_tool` spans last an instant. Compare tool time through `gen_ai.execute_tool.duration` and wall-clock time through `eval.turn`.

Spans record metadata. Pass `--trace-content` to also record prompts, replies, tool arguments and results, and step narration. Transcripts under `traces/` always hold that content. Set `OTEL_EXPORTER_OTLP_ENDPOINT` to also stream spans to a collector such as Jaeger or Phoenix.

Compare where scored runs spend their time, per condition:

```sql
select r.condition, r.variant, count(distinct trace_id) as runs,
       round(sum(s.duration_ms) filter (s.name = 'eval.turn') / runs) as turn_ms,
       count(*) filter (s.name like 'chat %') / runs as model_calls,
       round(sum(s.attributes."gen_ai.execute_tool.duration") * 1000 / runs) as tool_ms,
       round(sum(s.duration_ms) filter (s.name like 'vacp.execute %') / runs) as vacp_ms
from read_json('apps/evals/results/**/spans.jsonl', hive_partitioning = true, union_by_name = true) s
join read_json('apps/evals/results/**/results.jsonl', hive_partitioning = true, union_by_name = true) r using (trace_id)
group by all order by all;
```

## Rules the runner enforces

- **Audit before paying.** `eval audit` runs every oracle and control condition over every scenario. Each scenario must pass under every oracle and fail under every control. `eval audit --gold` re-derives every gold row from the data. An oracle with steps proves the page can reach the checked state. An answer-only oracle proves the checks accept a correct reply, and the gold row proves the answer against the raw data file, so a page that exposes less than that file fails every condition on the question.
- **A fixed split.** `split.json` holds 21 train and 11 test scenarios, drawn once at random within each capability. A flow refuses a different split. Read train transcripts when choosing a change, and judge it on test.
- **A fixed eval.** The first run of a flow records a digest of the eval's `src`, `scenarios`, `evals.config.ts`, and `package.json`, and of the repository's `patches` and `pnpm-workspace.yaml`, and needs `--approve-eval`. A later run exits with code 2 when any of them changed, until the change is reviewed and approved.
- **Fresh packages.** The eval imports its `@vacp/*` dependencies from their built `dist`, while the gallery serves their source. A run exits with code 2 when a package's source is newer than its build. Run `make build-libs` first.
- **Isolated runs.** Every run gets a fresh browser context and a hard wall-clock ceiling of 420 seconds. Agent steps are not paced, so latency measures VACP and the model.
- **Grader fixes re-grade in place.** When a check proves wrong, fix it and run `eval regrade --approve-eval`. Every recorded run is graded again from its `grading` inputs, with no model calls, and each variant reports how many rows changed and its pass rate before and after. Rewording a scenario's task or turns asks another question, so the next `run` drops the runs recorded for the old words and runs them again, and `regrade` leaves them as they were.
- **Failures classified.** A run that fails goes to `errors.jsonl` with the usage it billed, classed `setup`, `agent`, `provider`, `timeout`, `served-model-mismatch`, or `interrupted`. It never scores as zero, and a later run retries it. A failure while grading or recording a run is a bug in the eval, so the flow stops and the command exits with code 3.

## Hillclimbing VACP

A round changes VACP code in `packages/` or `examples/`, reruns the flow as the next variant, and compares:

```bash
pnpm --filter @vacp/evals eval run --condition webmcp --variant v1
pnpm --filter @vacp/evals eval summary --condition webmcp
```

The status table puts each variant's test pass rate beside a paired delta against baseline. The delta takes each test case's mean over its reps, so differences between cases cancel. A delta marked `within noise` does not justify keeping the change. With 32 scenarios and three reps a pass rate carries about ±10 points of noise. Token counts vary far less between runs, so cost per run and `read_chars` resolve smaller changes, as long as the pass rate holds.

## Serving the gallery

Without `--base-url`, `run`, `audit`, and `inspect` start the gallery's Vite dev server with Portless off, so a round's source edits apply without a build. Pass `--base-url` to share one server between flows running in parallel. Point it at a direct server such as `http://127.0.0.1:4480/`: a proxy in front of the dev server can fail module requests when several pages load at once, and a page that misses a module never registers its tools.

To keep measuring a baseline while you edit VACP, build the gallery once, copy `examples/gallery/dist` aside, and serve that copy with `vp preview --outDir <copy>`. The dev server picks up each edit, and the copy keeps the baseline's code.

## Code layout

Imports point inward: `cli.ts` and `run/` compose the layers, and `core/` imports nothing else in the app.

| Directory        | Holds                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `src/core`       | Scenarios, checks, assertions, grading, the run transcript, metrics, the split, and statistics  |
| `src/ports.ts`   | What conditions and the runner share: `Condition`, `AgentPage`, `Conversation`, and model types |
| `src/adapters`   | Playwright pages and the gallery host, OpenTelemetry tracing, and the model registry            |
| `src/conditions` | The agent, oracle, and control conditions                                                       |
| `src/results`    | The results layout, rows, the eval gate, regrading, and the status table                        |
| `src/run`        | One run's lifecycle, a flow's workers, the audit, and the environment checks                    |
