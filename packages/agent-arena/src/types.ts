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
   * Optional tags for filtering / grouping during analysis.
   */
  tags?: string[];
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
     * Useful for artifact naming and analysis joins.
     */
    slug: string;

    /**
     * OpenCode session ID created for this run (available after session creation).
     */
    sessionID?: string;
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
  };

  /**
   * Computed tool allow/deny map that will be applied for this run (if any).
   * Keys are OpenCode tool IDs (e.g. `bash`, `webfetch`, `edit`, `mcp_*` patterns).
   */
  tools?: Record<string, boolean>;
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

export type ArenaMcpExperiment = {
  /**
   * MCP servers to add/connect before running.
   *
   * `agent-arena` uses a single OpenCode server, so server setup is applied additively:
   * the union of all experiment `mcp.servers` is added before runs start.
   */
  servers?: Record<string, unknown>;

  /**
   * MCP tool exposure for this experiment.
   * - Server name `"context7"` expands to permission `"context7_*"`.
   * - You can also pass raw wildcard patterns (e.g. `"context7_*"`).
   *
   * Note: This only affects what the agent is allowed to call; it does not remove servers.
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
  model: { providerID: string; modelID: string };

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
  summarizeModel?: { providerID: string; modelID: string };
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
     * Use sparingly; most task-specific control should live in `runs`.
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
     * Max time to wait for a scenario's prompt to complete before aborting the session.
     */
    promptMs?: number;
  };

  /**
   * Auto-reply behavior for permission prompts (tool usage approvals).
   * Default is `"always"` to make runs fully non-interactive.
   */
  autoApprove?: 'off' | 'once' | 'always' | 'reject';

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
};

export type ArenaRunResult = {
  /**
   * Experiment name (grouping label).
   */
  experiment: string;

  /**
   * Scenario identity (kept small/portable; full task is in `inputs.json` / per-run `input.json`).
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
   * Error payload when `ok: false`.
   */
  error?: { message: string; stack?: string };

  /**
   * ISO timestamps for simple duration computation.
   */
  startedAt: string;
  finishedAt: string;
};
