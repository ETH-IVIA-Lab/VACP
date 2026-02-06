import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { ArenaConfig, ArenaJob, PromptContext } from './src/types';
import { mcpToolId } from './src/opencode-ids';
import { SCENARIO_BASES } from './agent-arena.scenarios';

export { SCENARIO_BASES };

const AGENT_ARENA_DIR = path.dirname(fileURLToPath(import.meta.url));
try {
  // Prefer local project secrets if present (Node >=20.6).
  process.loadEnvFile(path.join(AGENT_ARENA_DIR, '.env'));
} catch {
  // ignore
}

const BASE_URL = 'http://127.0.0.1:5173';

const MODELS = [
  { providerID: 'openai', modelID: 'gpt-5.2' },
  // { providerID: 'google-vertex', modelID: 'gemini-3-pro-preview' },
  // { providerID: 'amazon-bedrock', modelID: 'anthropic.claude-sonnet-4-5-20250929-v1:0' },
  // { providerID: 'amazon-bedrock', modelID: 'anthropic.claude-opus-4-6-v1' },
];

const DEFAULT_MCP_TIMEOUT_MS = 120_000;
const AGENT_BROWSER = 'agent-browser';
const CHART_READY_SELECTOR = '#app canvas, #app svg, #chart canvas, #chart svg';
const CHART_READY_SCREENSHOT_NAME = 'step-00.jpg';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const OPENCODE_ATTACH_DIRECTORY = (() => {
  const raw = process.env.VACP_ARENA_OPENCODE_DIR?.trim();
  if (!raw) return path.join(path.dirname(fileURLToPath(import.meta.url)), '.agent-arena');
  return path.isAbsolute(raw) ? raw : path.resolve(REPO_ROOT, raw);
})();

assertBaseUrlReachableSync(BASE_URL);

const AGENT_BROWSER_HELP = (() => {
  try {
    const stdout = execFileSync(AGENT_BROWSER, ['--help'], { encoding: 'utf8', timeout: 5000 });
    return String(stdout).trimEnd();
  } catch (error) {
    const stdout = (error as any)?.stdout ? String((error as any).stdout) : '';
    const stderr = (error as any)?.stderr ? String((error as any).stderr) : '';
    const combined = [stdout, stderr].filter(Boolean).join('\n').trim();
    if (combined) return combined;
    if (error instanceof Error) return `Failed to run "${AGENT_BROWSER} --help": ${error.message}`;
    return `Failed to run "${AGENT_BROWSER} --help": ${String(error)}`;
  }
})();

function agentBrowserEfficiencyGuidance(ctx: PromptContext): string[] {
  return [
    'agent-browser usage (must follow):',
    '- Do NOT run `agent-browser --help` (reference is included below).',
    `- Always pass \`--session ${ctx.opencode.sessionID}\` to \`${AGENT_BROWSER}\` commands.`,
    '- Keep command outputs small (avoid dumping large DOM/text).',
    `- Screenshots: write "${ctx.run.outDir}/step-00.jpg" for the initial visible chart; then use step-01.jpg, step-02.jpg, ...`,
    '- Take screenshots only after a meaningful UI/state change (do not take periodic screenshots).',
    '- Read screenshots only when you need visual grounding; at minimum, read step-00.jpg and any screenshot you rely on for the final answer.',
    `- Always use screenshot paths exactly as written: "${ctx.run.outDir}/step-00.jpg", "${ctx.run.outDir}/step-01.jpg", ...`,
    '- `eval`: pass JS in SINGLE quotes; avoid backticks and `${...}` to prevent shell expansion.',
    '',
    'agent-browser --help (pre-fetched for this run):',
    '```text',
    ...AGENT_BROWSER_HELP.split('\n'),
    '```',
  ];
}

function snapshotDomEfficiencyGuidance(): string[] {
  return [
    'DOM snapshot (`#__vacp_snapshot`) (semantic context):',
    '- Includes semantic details (e.g., field names/encodings and current params/filters/selections).',
    '- Do not print the whole snapshot; use `agent-browser eval` to extract only small, relevant pieces.',
    '- When using `eval` with the snapshot, follow the shell-safe `eval` rules above (single quotes, no backticks/`${...}`).',
    '- Ground the final answer in screenshots you READ (visual evidence), not the snapshot alone.',
  ];
}

function dataProvenanceGuardrails(): string[] {
  return [
    'Data provenance (must follow):',
    '- The benchmark datasets are intentionally edited and may differ from public/original versions.',
    '- Do NOT look up external datasets, docs, or similar examples on the internet for answering this task.',
    '- Do NOT rely on memorized values from prior exposure to common datasets.',
    '- Derive the answer only from evidence you obtain from this VA app in this run (interactions + observed state).',
  ];
}

function finalAnswerFormatBlock(ctx: PromptContext): string[] {
  return [
    'Final answer format (strict):',
    `1) Answer`,
    '- On its own line write `Answer:`.',
    `- On the following lines, output ONLY JSON inside \`\`\`json fences\`\`\`, matching \`${ctx.scenario.responseFormat}\`.`,
    '- Do not put reasoning inside the JSON.',
    '2) Reasoning',
    '- On its own line write `Reasoning:` then 1-3 brief sentences.',
    '3) Reflection',
    '- On its own line write `Reflection:` then 2-3 brief sentences.',
    '- Keep this narrative concise; machine-readable reflection details are required in step 4.',
    '- If any prior knowledge influenced the answer, explicitly state what was and was not verified via interaction.',
    '4) Reflection (structured)',
    '- On its own line write `Reflection (structured):`.',
    '- On the following lines, output ONLY JSON inside ```json fences with keys:',
    '- `provenance`: exactly `interaction-derived` OR `prior-knowledge/guess`',
    '- `confidence`: exactly `low` OR `medium` OR `high`',
    '- `easy_hard_why`: brief string describing what was easy/hard and why',
    '- `process_robustness`: must clearly indicate `robust` or `brittle` (you may include brief rationale)',
    '- `actions_tools_available_vs_used_why`: brief string explaining which actions/tools were available, which you used, and why',
    '- This structured block is mandatory, even when unsolved.',
    '5) Trace log',
    '- After Reflection, output a bullet list in execution order (one bullet per stateful step).',
    '- Exact bullet schema: `- step-01: <action> | <why> | <state change (vacp_state or other observable state)> | <progress toward answer>`.',
    '- Include Trace log even when unsolved.',
    '6) Trajectory',
    '- On its own line write `Trajectory:` then 3-6 sentences summarizing approach, pivots, failures, and why the final Answer was chosen; reference key trace steps where relevant.',
    'If blocked/unsolved:',
    '- Say unsolved explicitly; set Answer JSON value to `null` (inside ```json fences); explain the blocker.',
  ];
}

function buildScenarioUrl(args: { route: string; hash?: string; query?: Record<string, string> }): string {
  const u = new URL(args.route, BASE_URL);
  for (const [k, v] of Object.entries(args.query ?? {})) u.searchParams.set(k, v);
  if (args.hash) u.hash = args.hash.startsWith('#') ? args.hash : `#${args.hash}`;
  return u.toString();
}

const VACP_MCP_SERVER_NAME = 'arena_vacp';
const VACP_TOOLKIT_MCP_SERVER_NAME = 'arena_vacp_toolkit';

const VACP_MCP_PROJECT_DIR = path.join(REPO_ROOT, 'packages/vacp-mcp-server');
const VACP_MCP_BASE_COMMAND = [
  'uv',
  'run',
  '--project',
  VACP_MCP_PROJECT_DIR,
  'vacp-mcp-server',
  '--stdio',
  '--headless',
];

function buildVacpMcpServerConfig(url: string) {
  return {
    type: 'local',
    command: [...VACP_MCP_BASE_COMMAND, '--url', url],
    timeout: DEFAULT_MCP_TIMEOUT_MS,
    environment: { PYTHONUNBUFFERED: '1' },
  } as const;
}

function buildVacpToolkitMcpServerConfig(url: string) {
  return {
    type: 'local',
    command: [...VACP_MCP_BASE_COMMAND, '--url', url, '--enable-browser-tools'],
    timeout: DEFAULT_MCP_TIMEOUT_MS,
    environment: { PYTHONUNBUFFERED: '1' },
  } as const;
}

function buildBaselineJobs() {
  const jobs: ArenaJob[] = [];
  for (const model of MODELS) {
    for (const scenario of SCENARIO_BASES) {
      jobs.push({
        experiment: 'baseline',
        model,
        scenario: {
          id: scenario.id,
          url: buildScenarioUrl({ route: scenario.route, hash: scenario.hash, query: { 'expose-bridge': '0' } }),
          task: scenario.task,
          responseFormat: scenario.responseFormat,
        },
        toolPolicy: { mode: 'allow', ids: ['functions.bash', 'functions.read'] },
        promptTemplate: (ctx) =>
          [
            'Use the `bash` tool to run the `agent-browser` CLI (this is your browser access) and answer the task.',
            '',
            `Task: ${ctx.scenario.task}`,
            '',
            `Session: ${ctx.opencode.sessionID}`,
            `URL: ${ctx.scenario.url}`,
            '',
            'Boundaries (must follow):',
            '- Use only tools: `bash` + `read`.',
            `- (bash) may run ONLY \`${AGENT_BROWSER} ...\` commands (no other shell commands or scripting).`,
            `- (read) may open ONLY screenshots you create for this run under "${ctx.run.outDir}/step-00.jpg", "${ctx.run.outDir}/step-01.jpg", ...`,
            '- Treat the repository, local filesystem, and run artifacts as off-limits.',
            '- Finish by producing the "Final answer" section below (Answer can be `null`). Do not run until the prompt timeout.',
            '- If you are stuck, output `null` early rather than waiting for timeout.',
            '',
            ...dataProvenanceGuardrails(),
            '',
            ...agentBrowserEfficiencyGuidance(ctx),
            '',
            ...finalAnswerFormatBlock(ctx),
          ].join('\n'),
      });
    }
  }
  return jobs;
}

function buildSnapshotInjectedJobs() {
  const jobs: ArenaJob[] = [];
  for (const model of MODELS) {
    for (const scenario of SCENARIO_BASES) {
      jobs.push({
        experiment: 'with-snapshot',
        model,
        scenario: {
          id: scenario.id,
          url: buildScenarioUrl({
            route: scenario.route,
            hash: scenario.hash,
            query: { 'expose-bridge': '0', 'vacp-dom-snapshot': '1', 'vacp-debug': '0' },
          }),
          task: scenario.task,
          responseFormat: scenario.responseFormat,
        },
        toolPolicy: { mode: 'allow', ids: ['functions.bash', 'functions.read'] },
        promptTemplate: (ctx) =>
          [
            'Use the `bash` tool to run the `agent-browser` CLI (this is your browser access) and answer the task.',
            '',
            `Task: ${ctx.scenario.task}`,
            '',
            `Session: ${ctx.opencode.sessionID}`,
            `URL: ${ctx.scenario.url}`,
            '',
            'Boundaries (must follow):',
            '- Use only tools: `bash` + `read`.',
            `- (bash) may run ONLY \`${AGENT_BROWSER} ...\` commands (no other shell commands or scripting).`,
            `- (read) may open ONLY screenshots you create for this run under "${ctx.run.outDir}/step-00.jpg", "${ctx.run.outDir}/step-01.jpg", ...`,
            '- Treat the repository, local filesystem, and run artifacts as off-limits.',
            '- Finish by producing the "Final answer" section below (Answer can be `null`). Do not run until the prompt timeout.',
            '- If you are stuck, output `null` early rather than waiting for timeout.',
            '',
            ...dataProvenanceGuardrails(),
            '',
            ...agentBrowserEfficiencyGuidance(ctx),
            '',
            ...snapshotDomEfficiencyGuidance(),
            '',
            ...finalAnswerFormatBlock(ctx),
          ].join('\n'),
      });
    }
  }
  return jobs;
}

function buildPureVACPJobs() {
  const jobs: ArenaJob[] = [];
  const tools = {
    openUrl: mcpToolId(VACP_MCP_SERVER_NAME, 'vacp_open_url'),
    capabilities: mcpToolId(VACP_MCP_SERVER_NAME, 'vacp_capabilities'),
    state: mcpToolId(VACP_MCP_SERVER_NAME, 'vacp_state'),
    execute: mcpToolId(VACP_MCP_SERVER_NAME, 'vacp_execute'),
  } as const;

  for (const model of MODELS) {
    for (const scenario of SCENARIO_BASES) {
      const url = buildScenarioUrl({ route: scenario.route, hash: scenario.hash, query: { 'expose-bridge': '1' } });
      jobs.push({
        experiment: 'pure-vacp',
        model,
        scenario: { id: scenario.id, url, task: scenario.task, responseFormat: scenario.responseFormat },
        toolPolicy: { mode: 'allow', ids: [] },
        mcp: {
          servers: { [VACP_MCP_SERVER_NAME]: buildVacpMcpServerConfig(url) },
          allow: [VACP_MCP_SERVER_NAME],
        },
        promptTemplate: (ctx) =>
          [
            'Use the VACP MCP tools only (no shell, no webfetch).',
            '',
            `Task: ${ctx.scenario.task}`,
            '',
            'Hard constraints (must follow):',
            '- Do not attempt to read any local files, repo source, configs, or run artifacts.',
            '- Use only the VACP tools provided by the MCP server to interact with the app; do not rely on any other context.',
            '',
            'Important:',
            '- Do not start solving until the app is ready. In this run, you cannot take screenshots.',
            '- Do NOT spam/retry `vacp_open_url` in a loop (that reloads). Call it once with `wait_for_bridge=true` and a sufficiently large `timeout_ms`.',
            '- Verify readiness by successfully calling `vacp_open_url` and then reading both `vacp_capabilities` and `vacp_state` before any actions.',
            '- Validity requirement: if you did not successfully call VACP tools in this run, you MUST NOT claim `Provenance: interaction-derived` (treat it as a guess and/or output null if blocked).',
            '',
            ...dataProvenanceGuardrails(),
            '',
            'Efficiency (high priority):',
            '- Keep result sets tiny: prefer aggregations and tight `LIMIT`s; when using `vacp.data_sql`, pass a small `maxRows`.',
            '- Cast numeric-like strings via `try_cast(...)` to avoid lexicographic mistakes and reruns.',
            '',
            'Interaction style (must follow):',
            '- Solve the task by gradually changing the visualization state, like a human partner would (set params, apply selections, hover for tooltips).',
            '- Do NOT jump straight to computations/data extraction before you have set the relevant params/selections in the app.',
            '- Ground your answer ONLY in evidence you obtain through genuine interaction in this run (verified `vacp_state` + actions you performed). Do NOT use memorized/prior knowledge of the dataset/chart to answer.',
            '- If capabilities expose a SQL/data action (e.g. `vacp.data_sql`), use it only after the app state matches the question (e.g. year=2000, selection applied), and primarily to confirm/format the final answer.',
            `- After each interaction, call \`${tools.state}\` to verify the effect before doing the next step.`,
            '',
            `Start by calling \`${tools.openUrl}\` with: ${ctx.scenario.url}`,
            '',
            'Then:',
            `- Call \`${tools.capabilities}\` and use it as the source of truth for actions and schemas.`,
            `- Call \`${tools.state}\` to understand the current semantic state.`,
            `- Call \`${tools.execute}\` to perform one semantic operation at a time.`,
            `- After each action, call \`${tools.state}\` again to verify the effect.`,
            '',
            'If the required interaction is not available via VACP actions, state what capability is missing.',
            '',
            ...finalAnswerFormatBlock(ctx),
          ].join('\n'),
      });
    }
  }

  return jobs;
}

function buildFullToolkitJobs() {
  const jobs: ArenaJob[] = [];
  const tools = {
    openUrl: mcpToolId(VACP_TOOLKIT_MCP_SERVER_NAME, 'vacp_open_url'),
    capabilities: mcpToolId(VACP_TOOLKIT_MCP_SERVER_NAME, 'vacp_capabilities'),
    state: mcpToolId(VACP_TOOLKIT_MCP_SERVER_NAME, 'vacp_state'),
    execute: mcpToolId(VACP_TOOLKIT_MCP_SERVER_NAME, 'vacp_execute'),
    screenshot: mcpToolId(VACP_TOOLKIT_MCP_SERVER_NAME, 'browser_screenshot'),
    eval: mcpToolId(VACP_TOOLKIT_MCP_SERVER_NAME, 'browser_eval'),
    waitForSelector: mcpToolId(VACP_TOOLKIT_MCP_SERVER_NAME, 'browser_wait_for_selector'),
    click: mcpToolId(VACP_TOOLKIT_MCP_SERVER_NAME, 'browser_click'),
    fill: mcpToolId(VACP_TOOLKIT_MCP_SERVER_NAME, 'browser_fill'),
    press: mcpToolId(VACP_TOOLKIT_MCP_SERVER_NAME, 'browser_press'),
    sleep: mcpToolId(VACP_TOOLKIT_MCP_SERVER_NAME, 'browser_sleep'),
  } as const;

  for (const model of MODELS) {
    for (const scenario of SCENARIO_BASES) {
      const url = buildScenarioUrl({
        route: scenario.route,
        hash: scenario.hash,
        query: { 'expose-bridge': '1', 'vacp-dom-snapshot': '1', 'vacp-debug': '1' },
      });
      jobs.push({
        experiment: 'full-toolkit',
        model,
        scenario: { id: scenario.id, url, task: scenario.task, responseFormat: scenario.responseFormat },
        toolPolicy: { mode: 'allow', ids: ['functions.read'] },
        mcp: {
          servers: {
            [VACP_TOOLKIT_MCP_SERVER_NAME]: buildVacpToolkitMcpServerConfig(url),
          },
          allow: [VACP_TOOLKIT_MCP_SERVER_NAME],
        },
        promptTemplate: (ctx) =>
          [
            'Use VACP semantic tools plus browser-control tools (Playwright-backed).',
            '',
            `Task: ${ctx.scenario.task}`,
            '',
            'Hard constraints (must follow):',
            '- Treat the repository, local filesystem, and run artifacts as off-limits.',
            `- Do NOT use the \`read\` tool on anything except screenshots you create for this run: "${ctx.run.outDir}/step-00.jpg", "${ctx.run.outDir}/step-01.jpg", ...`,
            '- Do NOT try to solve by inspecting source files, configs, logs, or `.agent-arena/**` outputs.',
            '',
            ...dataProvenanceGuardrails(),
            '',
            'Efficiency (high priority; avoid timeouts + token bloat):',
            `- Prefer semantic tools (\`${tools.capabilities}\`, \`${tools.state}\`, \`${tools.execute}\`) over browser tools whenever possible.`,
            `- Use browser tools only to accomplish UI interactions not exposed semantically, and keep them minimal.`,
            `- Keep \`${tools.eval}\` outputs tiny; never dump large DOM/snapshot JSON.`,
            `- Only take screenshots after meaningful state changes, and avoid extra screenshots for failed attempts.`,
            `- Always use screenshot paths exactly as written (copy/paste): "${ctx.run.outDir}/step-00.jpg", "${ctx.run.outDir}/step-01.jpg", ...`,
            '',
            `Start by calling \`${tools.openUrl}\` with: ${ctx.scenario.url}`,
            '',
            'Chart-ready sentinel (must do before solving):',
            `- Sleep (minimum 5s): call \`${tools.sleep}\` with ms=5000.`,
            `- Wait for chart render: call \`${tools.waitForSelector}\` with selector "${CHART_READY_SELECTOR}" (increase timeout if needed).`,
            `- Screenshot (sentinel): call \`${tools.screenshot}\` with path "${ctx.run.outDir}/${CHART_READY_SCREENSHOT_NAME}".`,
            `- Visual check: use the \`read\` tool on "${ctx.run.outDir}/${CHART_READY_SCREENSHOT_NAME}" and confirm the chart is visibly rendered.`,
            `- If not visible yet: sleep 5s, wait again, and overwrite step-00.jpg (no reload/refresh/re-open). Repeat until visible.`,
            `- Once visible: call \`${tools.capabilities}\` and \`${tools.state}\` to see available interactions and the current semantic state.`,
            '',
            'Interaction style (must follow):',
            '- Solve the task by gradually changing the app state through human-like interactions (sliders, selections/brushes, hover tooltips, zoom/pan).',
            '- Do NOT jump straight to computations/data extraction before interacting; first drive the viz into the right state (e.g. year=2000, relevant selection applied).',
            '- Ground your answer ONLY in evidence you obtain through genuine interaction in this run (screenshots + verified `vacp_state`). Do NOT use memorized/prior knowledge of the dataset/chart to answer.',
            `- After each meaningful interaction:`,
            `  - Screenshot: call \`${tools.screenshot}\` with "${ctx.run.outDir}/step-01.jpg" (then step-02.jpg, step-03.jpg, ...; two digits).`,
            `  - Read the screenshot for visual grounding, then verify via \`${tools.state}\` before proceeding.`,
            '',
            'Preferred tools:',
            `- Use \`${tools.capabilities}\`, \`${tools.state}\`, \`${tools.execute}\` for semantic operations whenever possible.`,
            `- Use browser tools (\`${tools.click}\`, \`${tools.fill}\`, \`${tools.press}\`, \`${tools.eval}\`) only when needed for interactions not exposed semantically.`,
            `- Keep \`${tools.eval}\` for UI plumbing/debugging; do not use it to shortcut the task by scraping raw data and computing immediately.`,
            '',
            'If the required interaction is not available via VACP actions, state what capability is missing.',
            '',
            ...finalAnswerFormatBlock(ctx),
            '',
            'Browser tool list (for reference):',
            `- Screenshot: \`${tools.screenshot}\``,
            `- Eval: \`${tools.eval}\``,
            `- Wait for selector: \`${tools.waitForSelector}\``,
            `- Click: \`${tools.click}\``,
            `- Fill: \`${tools.fill}\``,
            `- Press: \`${tools.press}\``,
            `- Sleep: \`${tools.sleep}\``,
          ].join('\n'),
      });
    }
  }

  return jobs;
}

const execFileAsync = promisify(execFile);

function assertBaseUrlReachableSync(url: string) {
  if (process.env.VACP_ARENA_SKIP_PREFLIGHT?.trim() === '1') return;

  const timeoutMs = Number(process.env.VACP_ARENA_PREFLIGHT_TIMEOUT_MS ?? 1500);
  const u = new URL(url);
  const host = u.hostname;
  const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;

  const script = `
const net = require('node:net');
const host = process.env.VACP_PREFLIGHT_HOST;
const port = Number(process.env.VACP_PREFLIGHT_PORT);
const timeoutMs = Number(process.env.VACP_PREFLIGHT_TIMEOUT_MS || 1500);
const socket = net.connect({ host, port });
const finish = (code, message) => {
  try { socket.destroy(); } catch {}
  if (message) process.stderr.write(String(message) + '\\n');
  process.exit(code);
};
socket.setTimeout(timeoutMs, () => finish(1, 'timeout'));
socket.once('connect', () => finish(0));
socket.once('error', (err) => finish(1, err && err.message ? err.message : String(err)));
`.trim();

  try {
    execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: Math.max(timeoutMs + 1000, 2500),
      env: {
        ...process.env,
        VACP_PREFLIGHT_HOST: host,
        VACP_PREFLIGHT_PORT: String(port),
        VACP_PREFLIGHT_TIMEOUT_MS: String(timeoutMs),
      },
    });
  } catch (error) {
    const stderr = (error as any)?.stderr ? String((error as any).stderr).trim() : '';
    const stdout = (error as any)?.stdout ? String((error as any).stdout).trim() : '';
    const detail = [stderr, stdout].filter(Boolean).join('\n').trim();
    const hint = [
      `[agent-arena] Preflight failed: BASE_URL is not reachable (${u.origin}).`,
      detail ? `[agent-arena] Details: ${detail}` : undefined,
      '[agent-arena] Fix:',
      '- Start the local server (e.g. `pnpm dev:examples`) or update `BASE_URL` in agent-arena.config.ts.',
      '- Or skip this check by setting `VACP_ARENA_SKIP_PREFLIGHT=1`.',
    ]
      .filter(Boolean)
      .join('\n');
    throw new Error(hint);
  }
}

function sleepMs(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function listAgentBrowserSessions(): Promise<Set<string>> {
  try {
    const { stdout } = await execFileAsync(AGENT_BROWSER, ['--json', 'session', 'list'], { timeout: 10_000 });
    const parsed = JSON.parse(String(stdout)) as unknown;
    const sessions = (parsed as any)?.data?.sessions;
    if (!Array.isArray(sessions)) return new Set();
    return new Set(sessions.filter((s: unknown) => typeof s === 'string'));
  } catch {
    return new Set();
  }
}

async function closeAgentBrowserSessionHard(sessionID: string) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await execFileAsync(AGENT_BROWSER, ['--session', sessionID, 'close'], { timeout: 30_000 });
    } catch {
      // Best-effort: retry and verify via session list below.
    }

    await sleepMs(250 * attempt);

    const active = await listAgentBrowserSessions();
    if (!active.has(sessionID)) return;
  }

  const active = await listAgentBrowserSessions();
  if (active.has(sessionID)) {
    console.warn(`[agent-arena] agent-browser session still active after close retries: ${sessionID}`);
  }
}

async function closeAgentBrowserSession(ctx: Parameters<NonNullable<ArenaConfig['onFinished']>>[0]) {
  const sessionID = ctx.result.sessionID ?? ctx.opencode.sessionID;
  if (!sessionID) return;

  try {
    await closeAgentBrowserSessionHard(sessionID);
  } catch (error) {
    console.warn(`[agent-arena] Failed to close agent-browser session ${sessionID}`, error);
  }
}

const runs: ArenaJob[] = [
  ...buildBaselineJobs(),
  ...buildSnapshotInjectedJobs(),
  ...buildPureVACPJobs(),
  ...buildFullToolkitJobs(),
];

export const config: ArenaConfig = {
  directory: OPENCODE_ATTACH_DIRECTORY,
  worktreeRoot: false,
  autoApprove: 'always',
  concurrency: { runs: 8 },
  timeouts: { promptMs: 15 * 60_000 },
  server: {
    mode: 'connect',
  },
  onFinished: closeAgentBrowserSession,
  runs,
};

export default config;
