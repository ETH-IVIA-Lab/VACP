export type Scenario = {
  /**
   * Stable identifier used for folder names and run bookkeeping.
   * Defaults to `s<N>` if omitted.
   */
  id?: string;

  /**
   * URL of the target app/view to open (typically a local dev server + hash route).
   */
  url: string;

  /**
   * The user-facing task the agent should accomplish for this URL.
   */
  task: string;

  /**
   * Optional response schema/format hint for the final answer.
   *
   * Example: "{country: string, lifeExpectancy: number}"
   */
  responseFormat: string;

  /**
   * Optional tags for filtering / grouping during analysis.
   */
  tags?: string[];
};

export type ArenaModelPricing = {
  /**
   * USD per 1M input tokens.
   */
  input: number;

  /**
   * USD per 1M output tokens.
   */
  output: number;

  /**
   * USD per 1M cache read tokens.
   */
  cacheRead: number;

  /**
   * USD per 1M cache write tokens.
   */
  cacheWrite: number;
};

type ArenaModel = {
  providerID: string;
  modelID: string;

  /**
   * Optional manual pricing used for analysis-time cost estimation when provider-reported
   * session cost is missing or zero.
   */
  pricing?: ArenaModelPricing;
};

export type PromptContext = {
  /**
   * The scenario being executed (URL + task).
   */
  scenario: Scenario;

  /**
   * The run configuration used for this run (model + tool exposure, etc).
   */
  job: ArenaJob;

  /**
   * Run-specific values resolved right before prompting.
   */
  run: {
    /**
     * Per-run output directory on disk. This folder exists before the prompt is sent.
     */
    outDir: string;

    /**
     * Stable identifier derived from (model provider, model name, experiment, scenario id).
     * Used for artifact naming and analysis joins.
     */
    slug: string;
  };

  /**
   * Runtime context coming from the OpenCode server.
   */
  opencode: {
    /**
     * Effective OpenCode directory used for project/session context.
     */
    directory: string;

    /**
     * Current OpenCode project ID, if available.
     */
    projectID?: string;

    /**
     * OpenCode session ID created for this run (available after session creation).
     */
    sessionID?: string;
  };

  /**
   * Computed tool allow/deny map that will be applied for this run (if any).
   * Keys are OpenCode tool IDs (e.g. `bash`, `webfetch`, `edit`, `mcp_*` patterns).
   */
  tools?: Record<string, boolean>;
};

export type BeforePromptContext = Omit<PromptContext, 'opencode'> & {
  /**
   * Runtime context coming from the OpenCode server.
   *
   * `sessionID` is always available for pre-prompt setup hooks.
   */
  opencode: PromptContext['opencode'] & { sessionID: string };

  /**
   * Runtime lane metadata for this job execution.
   */
  runtime?: {
    workerID?: number;
    mcpServerAliases?: Record<string, string>;
  };

  /**
   * Abort signal tied to `timeouts.setupMs`.
   *
   * Long-running setup code should pass this signal to subprocesses/network calls
   * when supported.
   */
  abortSignal?: AbortSignal;
};

export type FinishedContext = PromptContext & {
  /**
   * The final outcome for this run (success/failure + session id when available).
   */
  result: ArenaRunResult;

  /**
   * True when the run was reused from disk via `resume` (no new session was created).
   */
  resumed: boolean;

  /**
   * File paths and UI links for post-processing.
   */
  meta: {
    /**
     * Arena output directory (the `--out` folder).
     */
    arenaOutDir: string;

    /**
     * Per-job output directory under `arenaOutDir/runs/...`.
     */
    jobOutDir: string;

    /**
     * Path to the per-run input payload written before prompting.
     */
    inputJsonPath?: string;

    /**
     * Path to the per-run result payload written after completion.
     */
    runJsonPath?: string;

    /**
     * OpenCode UI base URL for this arena invocation (if known).
     */
    uiBase?: string;

    /**
     * OpenCode UI link to the session (if a session was created).
     */
    liveUrl?: string;
  };
};

export type ToolPolicy =
  /**
   * Tool exposure policy for the agent.
   *
   * Notes:
   * - Patterns may include `*` wildcards (e.g. `context7_*` for all tools from an MCP server).
   * - `ids` can also be written as `functions.<name>` for convenience (it will be normalized).
   */
  { mode: 'all' } | { mode: 'none' } | { mode: 'allow'; ids: string[] } | { mode: 'deny'; ids: string[] };

type ArenaMcpExperiment = {
  /**
   * MCP servers to add/connect before running.
   *
   * `agent-arena` may alias server names per worker lane at runtime so runs can execute
   * concurrently without MCP name collisions while still using one OpenCode server.
   */
  servers?: Record<string, unknown>;

  /**
   * MCP tool exposure for this experiment.
   * - Server name `"context7"` expands to permission `"context7_*"`.
   * - You can also pass raw wildcard patterns (e.g. `"context7_*"`).
   *
   * This controls which MCP tools the agent may call. It does not remove server definitions.
   */
  allow?: string[];
};

export type ArenaJob = {
  /**
   * Experiment name (used in logs and output folder names).
   *
   * Multiple jobs can share the same `experiment` to group runs under one tool/model setup.
   */
  experiment: string;

  /**
   * Scenario definition for this run (URL + task).
   */
  scenario: Scenario;

  /**
   * The LLM used for this run.
   */
  model: ArenaModel;

  /**
   * Prompt for this run.
   *
   * This is evaluated right before sending the prompt, so it can include runtime values
   * like the resolved run output directory.
   */
  promptTemplate?: (ctx: PromptContext) => string;

  /**
   * Optional session title visible in the OpenCode UI.
   * If omitted, `agent-arena` uses a default based on experiment + scenario.
   */
  titleTemplate?: (ctx: PromptContext) => string;

  /**
   * Optional hook called after session creation and before prompting the model.
   *
   * Use this to do deterministic environment setup outside model turns
   * (e.g. pre-open URLs, wait for chart readiness).
   */
  onBeforePrompt?: (ctx: BeforePromptContext) => void | Promise<void>;

  /**
   * Optional hook called after the run finishes (success, error, or timeout).
   *
   * Prefer this for deterministic cleanup (e.g. closing external processes).
   */
  onFinished?: (ctx: FinishedContext) => void | Promise<void>;

  /**
   * Optional OpenCode agent preset name (if you use OpenCode "agents"/modes).
   */
  agent?: string;

  /**
   * Optional system prompt override.
   */
  system?: string;

  /**
   * Controls which tools are available to the agent for this run.
   */
  toolPolicy?: ToolPolicy;

  /**
   * MCP server setup + MCP tool exposure patterns for this run.
   */
  mcp?: ArenaMcpExperiment;

  /**
   * If true, request an OpenCode session summary after the prompt completes.
   */
  summarize?: boolean;

  /**
   * Optional model used for summarization (defaults to `model`).
   */
  summarizeModel?: ArenaModel;
};

export type ArenaConfig = {
  /**
   * Explicit OpenCode directory used for project/session context.
   * If set, this is the directory OpenCode uses to decide which project a session belongs to.
   */
  directory?: string;

  /**
   * Starting directory for resolving relative paths when `directory` is not provided.
   * Defaults to `process.cwd()`.
   */
  startDirectory?: string;

  /**
   * If true (default), use OpenCode's resolved worktree root as the effective directory.
   * This helps sessions show up under the expected project in the OpenCode UI.
   */
  worktreeRoot?: boolean;

  /**
   * Optional base output directory for the arena run.
   * CLI `--out` overrides this.
   */
  outDir?: string;

  server?: {
    /**
     * `spawn`: start a local `opencode serve` process for the duration of the run.
     * `connect`: reuse an already-running OpenCode server (`baseUrl` required).
     */
    mode: 'spawn' | 'connect';

    /**
     * Base URL for `mode: "connect"` (e.g. `http://127.0.0.1:3000`).
     */
    baseUrl?: string;

    /**
     * Bind hostname for `mode: "spawn"`.
     */
    hostname?: string;

    /**
     * Bind port for `mode: "spawn"`. If omitted, a free port is chosen.
     */
    port?: number;

    /**
     * Startup health timeout for the spawned server.
     */
    timeoutMs?: number;

    /**
     * Extra OpenCode config to inject into the spawned server (via env).
     * Keep task-specific control in `runs` unless the OpenCode server config must change.
     */
    opencodeConfig?: Record<string, unknown>;
  };

  concurrency?: {
    /**
     * Number of jobs to run concurrently.
     */
    runs?: number;
  };

  timeouts?: {
    /**
     * Max time to wait for pre-prompt setup hooks (`onBeforePrompt`) to finish.
     */
    setupMs?: number;

    /**
     * Max time to wait for a scenario's prompt to complete before aborting the session.
     */
    promptMs?: number;
  };

  /**
   * If true, reuse prior run results already present on disk (per-job `run.json`)
   * instead of creating a new OpenCode session.
   *
   * Use this with a stable `--out` directory (no timestamp).
   *
   * Notes:
   * - `agent-arena run --resume` reuses only `ok: true` results (reruns failures).
   * - `agent-arena resume` reuses any finished results (ok or failed) and runs only missing/unfinished jobs.
   * - `agent-arena resume --rerun-outcomes ...` can additionally rerun selected
   *   analysis outcomes (currently `protocol_failure`, `plumbing_failure`).
   */
  resume?: boolean;

  /**
   * Auto-reply behavior for permission prompts (tool usage approvals).
   * Default is `"always"` to make runs fully non-interactive.
   */
  autoApprove?: 'off' | 'once' | 'always' | 'reject';

  /**
   * Whether to auto-reject interactive model questions during runs.
   * Default is enabled to keep benchmark runs non-interactive.
   */
  autoQuestion?: 'off' | 'reject';

  /**
   * Flat list of jobs to execute. Each job already binds an experiment (model/tools)
   * to a scenario (URL + task). Define whatever combinations you want in your config file.
   */
  runs: ArenaJob[];

  /**
   * Default prompt template applied unless overridden per job.
   */
  promptTemplate?: (ctx: PromptContext) => string;

  /**
   * Default title template applied unless overridden per job.
   */
  titleTemplate?: (ctx: PromptContext) => string;

  /**
   * Default `onBeforePrompt` hook applied unless overridden per job.
   */
  onBeforePrompt?: (ctx: BeforePromptContext) => void | Promise<void>;

  /**
   * Default `onFinished` hook applied unless overridden per job.
   */
  onFinished?: (ctx: FinishedContext) => void | Promise<void>;
};

export type ArenaRunResult = {
  /**
   * Experiment name (grouping label).
   */
  experiment: string;

  /**
   * Scenario identity. The full task is stored in `inputs.json` and each run's `input.json`.
   */
  scenario: { id: string; url: string };

  /**
   * OpenCode project ID that the session belongs to.
   */
  projectID?: string;

  /**
   * OpenCode session ID created for this run.
   */
  sessionID?: string;

  /**
   * Whether the run completed successfully.
   */
  ok: boolean;

  /**
   * Optional pre-prompt setup phase metadata.
   */
  setup?: {
    ok: boolean;
    hook: 'job' | 'config';
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    error?: { message: string; stack?: string };
  };

  /**
   * Error payload when `ok: false`.
   */
  error?: { message: string; stack?: string };

  /**
   * ISO timestamps for simple duration computation.
   */
  startedAt: string;
  finishedAt: string;
};
