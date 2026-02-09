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
  { providerID: 'google-vertex', modelID: 'gemini-3-pro-preview' },
  { providerID: 'amazon-bedrock', modelID: 'anthropic.claude-sonnet-4-5-20250929-v1:0' },
  { providerID: 'amazon-bedrock', modelID: 'anthropic.claude-opus-4-6-v1' },
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

function agentBrowserEfficiencyGuidance(ctx: PromptContext): string[] {
  return [
    'agent-browser usage:',
    `- Always pass \`--session ${ctx.opencode.sessionID}\` to \`${AGENT_BROWSER}\` commands.`,
    '- Do NOT run `agent-browser --help`.',
    '- Keep command outputs small. Avoid large DOM/text dumps.',
    '- Open the URL once; do not repeat `open` unless the page clearly failed to load.',
    '- Use these exact command forms. Do not use `--url` or `--path` variants:',
    `- \`${AGENT_BROWSER} open \"<url>\" --session ${ctx.opencode.sessionID}\``,
    `- \`${AGENT_BROWSER} wait <ms> --session ${ctx.opencode.sessionID}\``,
    `- \`${AGENT_BROWSER} screenshot \"<path>\" --session ${ctx.opencode.sessionID}\``,
    `- \`${AGENT_BROWSER} eval '<js>' --session ${ctx.opencode.sessionID}\``,
    `- \`${AGENT_BROWSER} select <selector-or-@ref> <value> --session ${ctx.opencode.sessionID}\``,
    `- Save screenshots only under "${ctx.run.outDir}/step-XX.jpg". Use step-00 for the initial screenshot.`,
    '- Take screenshots only after meaningful state changes; avoid redundant screenshots.',
    '- Read only screenshots you rely on for the final answer.',
    '- `eval`: pass JS in SINGLE quotes; avoid backticks and `${...}` to prevent shell expansion.',
    '- `eval`: return compact JSON objects only.',
    '- `eval`: do NOT call `fetch`, `XMLHttpRequest`, or similar network APIs to pull raw dataset files or JSON payloads.',
    '- `eval`: use it for small interaction and state checks that a human can verify on-screen.',
  ];
}

function snapshotDomEfficiencyGuidance(): string[] {
  return [
    'DOM semantic layer (`#__vacp_snapshot`) guidance:',
    '- In `with-snapshot`, use this as the semantic map.',
    '- Prefer direct deterministic control operations first: `select`, sliders, buttons.',
    '- Use snapshot scripts when semantics are otherwise hidden, such as canvas-driven views, or when ref-level state is needed.',
    '- Read progressively: manifest -> state index -> catalog/ref scripts only when needed.',
    '- Use state token flow (`token`, `baseToken`, `changedRefs`, `removedRefs`) to avoid re-reading unchanged refs.',
    '- Do not read all ref scripts unless absolutely necessary for the task.',
    '- Canonical access:',
    '- `const manifest = JSON.parse(document.querySelector(\"#__vacp_snapshot\").textContent || \"{}\");`',
    '- `const index = JSON.parse(document.getElementById(manifest.state.indexScriptId).textContent || \"{}\");`',
    '- `const catalog = JSON.parse(document.getElementById(manifest.state.catalogScriptId).textContent || \"{}\");`',
    '- `const refEl = document.querySelector(\'script[data-vacp=\"snapshot-ref\"][data-vacp-ref=\"<ref>\"]\');`',
    '- Keep every `eval` result tiny. Return small objects only. Avoid broad DOM/snapshot dumps.',
    '- If two attempts on one path fail, pivot quickly.',
  ];
}

function vacpStateEfficiencyGuidance(stateTool: string): string[] {
  return [
    'VACP state strategy:',
    `- Call \`${stateTool}\` once without options to establish baseline context and token.`,
    `- When you need to re-check state, prefer \`${stateTool}\` with \`options={mode:\"delta\", since:\"<token>\"}\`.`,
    '- Use the returned `token` as your next `since` value.',
    '- In delta mode, use `baseToken`, `changedRefs`, and `removedRefs` to confirm what changed without re-reading unchanged state.',
    '- Once relevant refs are known, pass `refs` to limit payload scope.',
    '- Set `includeSummary=false` unless summary fields are needed for the current step.',
    '- If token lineage is unclear or delta data is unexpectedly uninformative, refresh with one `mode:\"full\"` call, then resume delta mode.',
  ];
}

function vacpToolRoutingGuidance(args: {
  capabilitiesTool: string;
  stateTool: string;
  executeTool: string;
  evalTool?: string;
  screenshotTool?: string;
}): string[] {
  const lines = [
    'Tool routing strategy:',
    `- Plan from \`${args.capabilitiesTool}\`, act via \`${args.executeTool}\`, verify via \`${args.stateTool}\`, and repeat.`,
    '- Prefer semantic VACP tools for all interactions they expose.',
  ];
  if (args.evalTool) {
    lines.push(
      `- Keep \`${args.evalTool}\` outputs minimal. Return small structs only. Never return large DOM/JSON dumps.`,
    );
    lines.push(
      `- Do NOT use \`${args.evalTool}\` to fetch/download raw dataset files or API payloads such as CSV, JSON, Parquet, or \`/data/*\` content.`,
    );
  }
  if (args.screenshotTool) {
    lines.push(
      `- Use \`${args.screenshotTool}\` at milestones: initial readiness and key evidence. Do not capture after every minor step.`,
    );
  }
  return lines;
}

function dataProvenanceGuardrails(): string[] {
  return [
    'Data provenance requirements:',
    '- The benchmark datasets are intentionally edited and may differ from public/original versions.',
    '- Do NOT look up external datasets, docs, or similar examples on the internet for answering this task.',
    '- Do NOT rely on memorized values from prior exposure to common datasets.',
    '- Do NOT fetch raw dataset files from app endpoints for solving, such as CSV, JSON, Parquet, or `/data/*` payloads.',
    '- Derive the answer only from evidence you obtain from this VA app in this run (interactions + observed state).',
  ];
}

function humanTraceabilityGuidance(): string[] {
  return [
    'Traceability requirements:',
    '- Build the answer from interaction evidence a human can replay in the UI: controls, selections, hovers, and visible state changes.',
    '- Prefer interaction-derived evidence over raw data extraction shortcuts.',
    '- In `Reasoning`, reference the key interaction steps that support the answer.',
  ];
}

function finalAnswerFormatBlock(ctx: PromptContext): string[] {
  return [
    'Final answer format you must follow:',
    '1) Answer',
    '- On its own line write `Answer:`.',
    `- On the following lines, output ONLY JSON inside \`\`\`json fences\`\`\`, matching \`${ctx.scenario.responseFormat}\`.`,
    '- Do not put reasoning inside the JSON.',
    '2) Reasoning',
    '- On its own line write `Reasoning:` then 1-2 concise sentences grounded in run evidence.',
    '3) Reflection',
    '- On its own line write `Reflection:` then 1-2 concise sentences with uncertainty/blockers.',
    'If blocked/unsolved:',
    '- If available context or allowed capabilities are insufficient to solve reliably, do not guess.',
    '- You may stop early once this is clear.',
    '- Say unsolved explicitly; set Answer JSON value to `null` inside ```json fences; explain the blocker briefly.',
  ];
}

function fullToolkitScreenshotGuidance(args: {
  runOutDir: string;
  screenshotTool: string;
  sleepTool: string;
  waitForSelectorTool: string;
  capabilitiesTool: string;
  stateTool: string;
}): string[] {
  return [
    'Screenshot policy:',
    `- Use only screenshot paths under "${args.runOutDir}/step-*.jpg". Use two-digit sequence names such as step-00, step-01, and step-02.`,
    `- Chart-ready sentinel: \`${args.sleepTool}\` with ms=5000 -> \`${args.waitForSelectorTool}\` with selector "${CHART_READY_SELECTOR}" -> \`${args.screenshotTool}\` to "${args.runOutDir}/${CHART_READY_SCREENSHOT_NAME}" -> \`read\` step-00.`,
    `- If step-00 is not visibly ready, repeat sleep + wait and overwrite "${args.runOutDir}/${CHART_READY_SCREENSHOT_NAME}". Do not reload or re-open the page.`,
    `- Once visible, call \`${args.capabilitiesTool}\` and \`${args.stateTool}\` before solving.`,
    '- After each meaningful state change, capture the next step image and read it for visual grounding.',
    '- Avoid redundant screenshots for repeated/failed attempts.',
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
            'Use the `bash` tool to run the `agent-browser` CLI. This is your browser access for this run.',
            '',
            `Task: ${ctx.scenario.task}`,
            '',
            `Session: ${ctx.opencode.sessionID}`,
            `URL: ${ctx.scenario.url}`,
            '',
            'Boundaries you must follow:',
            '- Use only tools: `bash` + `read`.',
            `- \`bash\` may run only \`${AGENT_BROWSER} ...\` commands. Do not run other shell commands or scripting.`,
            `- \`read\` may open only screenshots you create for this run under "${ctx.run.outDir}/step-*.jpg".`,
            '- Treat the repository, local filesystem, and run artifacts as off-limits.',
            '- Finish by producing the "Final answer" section below. Answer can be `null`.',
            '- If you are stuck, output `null` early rather than waiting for timeout.',
            '',
            ...dataProvenanceGuardrails(),
            '',
            ...humanTraceabilityGuidance(),
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
            'Use the `bash` tool to run the `agent-browser` CLI. This is your browser access for this run.',
            '',
            `Task: ${ctx.scenario.task}`,
            '',
            `Session: ${ctx.opencode.sessionID}`,
            `URL: ${ctx.scenario.url}`,
            '',
            'Boundaries you must follow:',
            '- Use only tools: `bash` + `read`.',
            `- \`bash\` may run only \`${AGENT_BROWSER} ...\` commands. Do not run other shell commands or scripting.`,
            `- \`read\` may open only screenshots you create for this run under "${ctx.run.outDir}/step-*.jpg".`,
            '- Treat the repository, local filesystem, and run artifacts as off-limits.',
            '- Finish by producing the "Final answer" section below. Answer can be `null`.',
            '- If you are stuck, output `null` early rather than waiting for timeout.',
            '',
            ...dataProvenanceGuardrails(),
            '',
            ...humanTraceabilityGuidance(),
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
            'Use only VACP MCP tools. Do not use shell commands or webfetch.',
            '',
            `Task: ${ctx.scenario.task}`,
            '',
            'Hard constraints you must follow:',
            '- Do not attempt to read any local files, repo source, configs, or run artifacts.',
            '- Use only the VACP tools provided by the MCP server to interact with the app; do not rely on any other context.',
            '',
            'Important:',
            '- Do not start solving until the app is ready. In this run, you cannot take screenshots.',
            '- Do NOT spam/retry `vacp_open_url` in a loop because it reloads. Call it once with `wait_for_bridge=true` and a sufficiently large `timeout_ms`.',
            '- Verify readiness by successfully calling `vacp_open_url` and then reading both `vacp_capabilities` and `vacp_state` before any actions.',
            '',
            ...dataProvenanceGuardrails(),
            '',
            ...humanTraceabilityGuidance(),
            '',
            ...vacpStateEfficiencyGuidance(tools.state),
            '',
            'Efficiency guidance with high priority:',
            '- Keep result sets tiny: prefer aggregations and tight `LIMIT`s; when using `vacp.data_sql`, pass a small `maxRows`.',
            '- Cast numeric-like strings via `try_cast(...)` to avoid lexicographic mistakes and reruns.',
            '- Keep `vacp_state` reads token-efficient: baseline once, then use `mode:"delta"` with `since=<latest token>` and rely on `changedRefs` and `removedRefs`.',
            '',
            'Interaction style you must follow:',
            '- Solve the task by gradually changing the visualization state like a human partner would: set params, apply selections, and hover for tooltips.',
            '- Do NOT jump straight to computations/data extraction before you have set the relevant params/selections in the app.',
            '- If capabilities expose a SQL/data action such as `vacp.data_sql`, use it only after the app state matches the question, for example year=2000 with selection applied, and primarily to confirm or format the final answer.',
            `- Use \`${tools.state}\` to verify key state transitions and to track progress toward the answer.`,
            '',
            `Start by calling \`${tools.openUrl}\` with: ${ctx.scenario.url}`,
            '',
            'Then:',
            `- Call \`${tools.capabilities}\` and use it as the source of truth for actions and schemas.`,
            `- Call \`${tools.state}\` to understand the current semantic state.`,
            `- Call \`${tools.execute}\` to perform one semantic operation at a time.`,
            `- Use \`${tools.state}\` as needed after actions to confirm effects before finalizing the answer.`,
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
            'Use VACP semantic tools plus browser-control tools backed by Playwright.',
            '',
            `Task: ${ctx.scenario.task}`,
            '',
            'Hard constraints you must follow:',
            '- Treat the repository, local filesystem, and run artifacts as off-limits.',
            `- Do NOT use the \`read\` tool on anything except screenshots you create for this run under "${ctx.run.outDir}/step-*.jpg".`,
            '- Do NOT try to solve by inspecting source files, configs, logs, or `.agent-arena/**` outputs.',
            '',
            ...dataProvenanceGuardrails(),
            '',
            ...humanTraceabilityGuidance(),
            '',
            ...vacpToolRoutingGuidance({
              capabilitiesTool: tools.capabilities,
              stateTool: tools.state,
              executeTool: tools.execute,
              evalTool: tools.eval,
            }),
            '',
            ...vacpStateEfficiencyGuidance(tools.state),
            '',
            'Efficiency guidance with high priority:',
            `- Prefer semantic tools (\`${tools.capabilities}\`, \`${tools.state}\`, \`${tools.execute}\`) over browser tools whenever possible.`,
            `- Use browser tools only to accomplish UI interactions not exposed semantically, and keep them minimal.`,
            `- Keep \`${tools.eval}\` outputs tiny; never dump large DOM/snapshot JSON.`,
            `- Keep \`${tools.state}\` token-efficient: baseline once, then use \`mode:\"delta\"\` with \`since=<latest token>\` and rely on \`changedRefs\` and \`removedRefs\`.`,
            '',
            `Start by calling \`${tools.openUrl}\` with: ${ctx.scenario.url}`,
            '',
            ...fullToolkitScreenshotGuidance({
              runOutDir: ctx.run.outDir,
              screenshotTool: tools.screenshot,
              sleepTool: tools.sleep,
              waitForSelectorTool: tools.waitForSelector,
              capabilitiesTool: tools.capabilities,
              stateTool: tools.state,
            }),
            '',
            'Interaction style you must follow:',
            '- Solve the task by gradually changing the app state through human-like interactions: sliders, selections or brushes, hover tooltips, and zoom or pan.',
            '- Do NOT jump straight to computations or data extraction before interacting; first drive the viz into the right state, for example year=2000 with relevant selection applied.',
            `- Use \`${tools.state}\` when needed to verify key state transitions before finalizing the answer.`,
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
            'Browser tool list:',
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
