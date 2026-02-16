import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { ArenaConfig, ArenaJob, BeforePromptContext, PromptContext } from './src/types';
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
  //{ providerID: 'github-copilot', modelID: 'claude-sonnet-4.5' },
  //{ providerID: 'amazon-bedrock', modelID: 'anthropic.claude-sonnet-4-5-20250929-v1:0' },
  //{ providerID: 'amazon-bedrock', modelID: 'anthropic.claude-opus-4-6-v1' },
];

const DEFAULT_MCP_TIMEOUT_MS = 120_000;
const AGENT_BROWSER = 'agent-browser';
const CHART_READY_SELECTOR = '#app canvas, #app svg, #chart canvas, #chart svg';
const CHART_READY_SCREENSHOT_NAME = 'step-00.png';
const CHART_READY_WAIT_TIMEOUT_MS = Number(process.env.VACP_ARENA_CHART_READY_WAIT_TIMEOUT_MS ?? 45_000);
const AGENT_BROWSER_SETUP_OPEN_TIMEOUT_MS = Number(process.env.VACP_ARENA_SETUP_OPEN_TIMEOUT_MS ?? 30_000);
const AGENT_BROWSER_SETUP_WAIT_TIMEOUT_MS = Number(process.env.VACP_ARENA_SETUP_WAIT_TIMEOUT_MS ?? 45_000);
const AGENT_BROWSER_SETUP_RELOAD_TIMEOUT_MS = Number(process.env.VACP_ARENA_SETUP_RELOAD_TIMEOUT_MS ?? 20_000);
const AGENT_BROWSER_SETUP_RETRY_SLEEP_MS = Number(process.env.VACP_ARENA_SETUP_RETRY_SLEEP_MS ?? 800);
const AGENT_BROWSER_SETUP_MAX_ATTEMPTS = Number(process.env.VACP_ARENA_SETUP_MAX_ATTEMPTS ?? 5);
const AGENT_BROWSER_SETUP_STEP0_MIN_BYTES = Number(process.env.VACP_ARENA_SETUP_STEP0_MIN_BYTES ?? 1_500);
const AGENT_BROWSER_SETUP_MIN_NON_WHITE_FRACTION = Number(process.env.VACP_ARENA_SETUP_MIN_NON_WHITE_FRACTION ?? 0.005);
const VACP_MCP_STARTUP_READY_TIMEOUT_MS = Number(process.env.VACP_ARENA_MCP_READY_TIMEOUT_MS ?? 45_000);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const OPENCODE_ATTACH_DIRECTORY = (() => {
  const raw = process.env.VACP_ARENA_OPENCODE_DIR?.trim();
  if (!raw) return path.join(path.dirname(fileURLToPath(import.meta.url)), '.agent-arena');
  return path.isAbsolute(raw) ? raw : path.resolve(REPO_ROOT, raw);
})();
const DEFAULT_RUN_OUT_DIR = path.join(OPENCODE_ATTACH_DIRECTORY, 'runs', buildRunStamp());

assertBaseUrlReachableSync(BASE_URL);

function agentBrowserEfficiencyGuidance(ctx: PromptContext, options?: { preopened?: boolean }): string[] {
  const preopened = options?.preopened ?? false;
  const runArtifactDir = resolvePromptRunArtifactDir(ctx);
  return [
    'agent-browser usage:',
    `- Always pass \`--session ${ctx.opencode.sessionID}\` to \`${AGENT_BROWSER}\` commands.`,
    '- Do NOT run `agent-browser --help`.',
    '- Keep command outputs small. Avoid large DOM/text dumps.',
    ...(preopened
      ? [
          '- The scenario URL is already open and chart-ready before your turn. Do not call `open` unless recovery is necessary.',
        ]
      : ['- Open the URL once; do not repeat `open` unless the page clearly failed to load.']),
    '- Use these exact command forms. Do not use `--url` or `--path` variants:',
    ...(preopened ? [] : [`- \`${AGENT_BROWSER} open \"<url>\" --session ${ctx.opencode.sessionID}\``]),
    `- \`${AGENT_BROWSER} wait <ms> --session ${ctx.opencode.sessionID}\``,
    `- \`${AGENT_BROWSER} screenshot \"<path>\" --session ${ctx.opencode.sessionID}\``,
    `- \`${AGENT_BROWSER} eval '<js>' --session ${ctx.opencode.sessionID}\``,
    `- \`${AGENT_BROWSER} select <selector-or-@ref> <value> --session ${ctx.opencode.sessionID}\``,
    ...(preopened
      ? [
          `- Save screenshots only under "${runArtifactDir}/step-XX.png". Warmup already captured step-00; read it first and recapture only if recovery is necessary.`,
        ]
      : [`- Save screenshots only under "${runArtifactDir}/step-XX.png". Use step-00 for the initial screenshot.`]),
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
  runArtifactDir: string;
  screenshotTool: string;
  capabilitiesTool: string;
  stateTool: string;
}): string[] {
  return [
    'Screenshot policy:',
    `- Use only screenshot paths under "${args.runArtifactDir}/step-*.png". Use two-digit sequence names such as step-00, step-01, and step-02.`,
    '- The scenario URL is already open and chart-ready before your turn starts.',
    `- Warmup already captured "${args.runArtifactDir}/${CHART_READY_SCREENSHOT_NAME}". First action: \`read\` step-00.`,
    `- Once visible, call \`${args.capabilitiesTool}\` and \`${args.stateTool}\` before solving.`,
    `- Capture the next screenshot with \`${args.screenshotTool}\` only after your first meaningful state change.`,
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

function buildRunStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
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
  const readyTimeoutMs = String(positiveIntOr(VACP_MCP_STARTUP_READY_TIMEOUT_MS, 45_000));
  return {
    type: 'local',
    command: [
      ...VACP_MCP_BASE_COMMAND,
      '--url',
      url,
      '--startup-wait-for-bridge',
      '--startup-ready-timeout-ms',
      readyTimeoutMs,
    ],
    timeout: DEFAULT_MCP_TIMEOUT_MS,
    environment: { PYTHONUNBUFFERED: '1' },
  } as const;
}

function buildVacpToolkitMcpServerConfig(url: string) {
  const readyTimeoutMs = String(positiveIntOr(VACP_MCP_STARTUP_READY_TIMEOUT_MS, 45_000));
  const selectorTimeoutMs = String(positiveIntOr(CHART_READY_WAIT_TIMEOUT_MS, 45_000));
  return {
    type: 'local',
    command: [
      ...VACP_MCP_BASE_COMMAND,
      '--url',
      url,
      '--enable-browser-tools',
      '--startup-wait-for-bridge',
      '--startup-ready-timeout-ms',
      readyTimeoutMs,
      '--startup-wait-for-selector',
      CHART_READY_SELECTOR,
      '--startup-selector-state',
      'visible',
      '--startup-selector-timeout-ms',
      selectorTimeoutMs,
    ],
    timeout: DEFAULT_MCP_TIMEOUT_MS,
    environment: { PYTHONUNBUFFERED: '1' },
  } as const;
}

type SetupCommand = {
  label: string;
  command: string;
  args: string[];
  timeoutMs: number;
  signal?: AbortSignal;
};

function positiveIntOr(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

async function runSetupCommand(cmd: SetupCommand) {
  await runSetupCommandDetailed(cmd);
}

async function runSetupCommandDetailed(cmd: SetupCommand): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(cmd.command, cmd.args, {
      timeout: positiveIntOr(cmd.timeoutMs, 30_000),
      maxBuffer: 1024 * 1024,
      ...(cmd.signal ? { signal: cmd.signal } : {}),
    });
    return {
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
    };
  } catch (error) {
    const message = formatExecError(error);
    throw new Error(`Setup step failed (${cmd.label}): ${message}`);
  }
}

function formatExecError(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  const stdout = typeof (error as any).stdout === 'string' ? String((error as any).stdout).trim() : '';
  const stderr = typeof (error as any).stderr === 'string' ? String((error as any).stderr).trim() : '';
  const detail = [stderr, stdout].filter(Boolean).join('\n').trim();
  return detail ? `${error.message}\n${detail}` : error.message;
}

async function preopenScenarioWithAgentBrowser(ctx: BeforePromptContext) {
  const sessionID = ctx.opencode.sessionID;
  const openTimeoutMs = positiveIntOr(AGENT_BROWSER_SETUP_OPEN_TIMEOUT_MS, 30_000);
  const readyTimeoutMs = positiveIntOr(AGENT_BROWSER_SETUP_WAIT_TIMEOUT_MS, 45_000);
  const reloadTimeoutMs = positiveIntOr(AGENT_BROWSER_SETUP_RELOAD_TIMEOUT_MS, 20_000);
  const retrySleepMs = positiveIntOr(AGENT_BROWSER_SETUP_RETRY_SLEEP_MS, 800);
  const maxAttempts = positiveIntOr(AGENT_BROWSER_SETUP_MAX_ATTEMPTS, 5);
  const step00Path = resolveRunArtifactPath(ctx, CHART_READY_SCREENSHOT_NAME);
  const attemptNotes: string[] = [];

  await runSetupCommand({
    label: 'agent-browser open',
    command: AGENT_BROWSER,
    args: ['open', ctx.scenario.url, '--session', sessionID],
    timeoutMs: openTimeoutMs,
    signal: ctx.abortSignal,
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await runSetupCommand({
        label: `agent-browser wait chart selector (attempt ${attempt})`,
        command: AGENT_BROWSER,
        args: ['wait', CHART_READY_SELECTOR, '--session', sessionID],
        timeoutMs: readyTimeoutMs,
        signal: ctx.abortSignal,
      });
      await runSetupCommand({
        label: `agent-browser screenshot ${CHART_READY_SCREENSHOT_NAME} (attempt ${attempt})`,
        command: AGENT_BROWSER,
        args: ['screenshot', step00Path, '--session', sessionID],
        timeoutMs: readyTimeoutMs,
        signal: ctx.abortSignal,
      });

      const shotCheck = await validateStep00Screenshot({
        sessionID,
        screenshotPath: step00Path,
        timeoutMs: readyTimeoutMs,
        signal: ctx.abortSignal,
      });
      if (shotCheck.ok) return;

      attemptNotes.push(`attempt ${attempt}: ${shotCheck.reason}`);
    } catch (error) {
      attemptNotes.push(`attempt ${attempt}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (attempt >= maxAttempts) break;

    await runSetupCommand({
      label: `agent-browser reload (attempt ${attempt + 1})`,
      command: AGENT_BROWSER,
      args: ['reload', '--session', sessionID],
      timeoutMs: reloadTimeoutMs,
      signal: ctx.abortSignal,
    });
    await sleepMs(retrySleepMs);
  }

  throw new Error(
    [
      `Failed to prepare chart-ready ${CHART_READY_SCREENSHOT_NAME} after ${maxAttempts} attempts.`,
      ...attemptNotes,
    ].join('\n'),
  );
}

async function validateStep00Screenshot(args: {
  sessionID: string;
  screenshotPath: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; reason: string }> {
  const minBytes = positiveIntOr(AGENT_BROWSER_SETUP_STEP0_MIN_BYTES, 1_500);
  let st: { size: number } | null = null;
  try {
    st = await fs.stat(args.screenshotPath);
  } catch {
    return { ok: false, reason: `missing_screenshot:${args.screenshotPath}` };
  }
  if (!st || st.size < minBytes) {
    return { ok: false, reason: `screenshot_too_small:${st?.size ?? 0}B` };
  }

  const visual = await evaluateChartVisualReadiness(args);
  if (!visual.ok) return visual;
  return { ok: true, reason: `ok:size=${st.size}` };
}

async function evaluateChartVisualReadiness(args: {
  sessionID: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; reason: string }> {
  const threshold = AGENT_BROWSER_SETUP_MIN_NON_WHITE_FRACTION;
  const script = `
(() => {
  const selector = ${JSON.stringify(CHART_READY_SELECTOR)};
  const threshold = ${Number.isFinite(threshold) ? threshold : 0.005};
  const root = document.querySelector(selector);
  if (!root) return { ok: false, reason: 'selector_missing' };

  const canvas = root instanceof HTMLCanvasElement ? root : root.querySelector('canvas');
  if (canvas instanceof HTMLCanvasElement) {
    const w = Math.max(1, canvas.width | 0);
    const h = Math.max(1, canvas.height | 0);
    if (w < 2 || h < 2) return { ok: false, reason: 'canvas_too_small', width: w, height: h };
    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return { ok: false, reason: 'canvas_no_context' };
      const data = ctx.getImageData(0, 0, w, h).data;
      const maxSamples = 5000;
      const stride = Math.max(1, Math.floor((w * h) / maxSamples));
      let sampled = 0;
      let nonWhite = 0;
      for (let p = 0; p < w * h; p += stride) {
        const i = p * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (a > 0 && (r < 245 || g < 245 || b < 245)) nonWhite += 1;
        sampled += 1;
      }
      const frac = sampled > 0 ? nonWhite / sampled : 0;
      return {
        ok: frac >= threshold,
        reason: frac >= threshold ? 'canvas_non_white_ok' : 'canvas_too_white',
        nonWhiteFraction: frac,
        sampled,
      };
    } catch (error) {
      return { ok: false, reason: 'canvas_read_error', error: String(error) };
    }
  }

  const svg = root instanceof SVGElement ? root : root.querySelector('svg');
  if (svg instanceof SVGElement) {
    const painted = svg.querySelectorAll(
      '[fill]:not([fill="none"]):not([fill="white"]):not([fill="#fff"]):not([fill="#ffffff"]),[stroke]:not([stroke="none"]):not([stroke="white"]):not([stroke="#fff"]):not([stroke="#ffffff"])',
    ).length;
    const text = (svg.textContent || '').replace(/\\s+/g, '').length;
    let area = 0;
    try {
      if (typeof svg.getBBox === 'function') {
        const box = svg.getBBox();
        area = Number(box.width || 0) * Number(box.height || 0);
      }
    } catch {}
    const ok = painted > 2 || text > 8 || area > 5000;
    return { ok, reason: ok ? 'svg_content_ok' : 'svg_low_content', painted, text, area };
  }

  return { ok: false, reason: 'no_canvas_or_svg' };
})()
`.trim();

  const value = await runAgentBrowserJson({
    sessionID: args.sessionID,
    commandArgs: ['eval', script],
    timeoutMs: args.timeoutMs,
    signal: args.signal,
  });
  const payload =
    value && typeof value === 'object' && 'result' in (value as any) && (value as any).result
      ? (value as any).result
      : value;
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'visual_eval_invalid' };
  const ok = Boolean((payload as any).ok);
  const reason = String((payload as any).reason ?? 'visual_eval_failed');
  return { ok, reason };
}

function resolveRunArtifactPath(ctx: BeforePromptContext, fileName: string) {
  return path.join(resolveRunArtifactDir({ runOutDir: ctx.run.outDir, opencodeDir: ctx.opencode.directory }), fileName);
}

function resolvePromptRunArtifactDir(ctx: PromptContext) {
  return resolveRunArtifactDir({ runOutDir: ctx.run.outDir, opencodeDir: ctx.opencode.directory });
}

function resolveRunArtifactDir(args: { runOutDir: string; opencodeDir: string }) {
  return path.isAbsolute(args.runOutDir) ? path.resolve(args.runOutDir) : path.resolve(args.opencodeDir, args.runOutDir);
}

async function runAgentBrowserJson(args: {
  sessionID: string;
  commandArgs: string[];
  timeoutMs: number;
  signal?: AbortSignal;
}) {
  const res = await runSetupCommandDetailed({
    label: `agent-browser ${args.commandArgs.join(' ')}`,
    command: AGENT_BROWSER,
    args: ['--json', '--session', args.sessionID, ...args.commandArgs],
    timeoutMs: args.timeoutMs,
    signal: args.signal,
  });
  const raw = (res.stdout || '').trim();
  if (!raw) throw new Error('agent-browser returned empty JSON output');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`agent-browser returned non-JSON output: ${raw.slice(0, 300)}`);
  }

  if (parsed && typeof parsed === 'object' && (parsed as any).success === false) {
    throw new Error(String((parsed as any).error ?? 'agent-browser JSON command failed'));
  }

  if (parsed && typeof parsed === 'object' && 'data' in (parsed as any)) {
    return (parsed as any).data;
  }
  return parsed;
}

async function onBeforePromptSetup(ctx: BeforePromptContext) {
  if (ctx.job.experiment === 'baseline' || ctx.job.experiment === 'with-snapshot' || ctx.job.experiment === 'full-toolkit') {
    await preopenScenarioWithAgentBrowser(ctx);
  }
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
          url: buildScenarioUrl({
            route: scenario.route,
            hash: scenario.hash,
            query: { 'expose-bridge': '0', 'vacp-dom-snapshot': '0', 'vacp-debug': '0' },
          }),
          task: scenario.task,
          responseFormat: scenario.responseFormat,
        },
        toolPolicy: { mode: 'allow', ids: ['functions.bash', 'functions.read'] },
        onBeforePrompt: onBeforePromptSetup,
        promptTemplate: (ctx) => {
          const runArtifactDir = resolvePromptRunArtifactDir(ctx);
          return [
            'Use the `bash` tool to run the `agent-browser` CLI. This is your browser access for this run.',
            '',
            `Task: ${ctx.scenario.task}`,
            '',
            `Session: ${ctx.opencode.sessionID}`,
            `Scenario URL (already opened): ${ctx.scenario.url}`,
            '',
            'Boundaries you must follow:',
            '- Use only tools: `bash` + `read`.',
            `- \`bash\` may run only \`${AGENT_BROWSER} ...\` commands. Do not run other shell commands or scripting.`,
            `- \`read\` may open only screenshots for this run under "${runArtifactDir}/step-*.png", including warmup step-00.`,
            '- The page is already opened and chart-ready before this turn starts. Do not spend turns on setup dance.',
            '- Treat the repository, local filesystem, and run artifacts as off-limits.',
            '- Finish by producing the "Final answer" section below. Answer can be `null`.',
            '- If you are stuck, output `null` early rather than waiting for timeout.',
            '',
            ...dataProvenanceGuardrails(),
            '',
            ...humanTraceabilityGuidance(),
            '',
            ...agentBrowserEfficiencyGuidance(ctx, { preopened: true }),
            '',
            ...finalAnswerFormatBlock(ctx),
          ].join('\n');
        },
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
        onBeforePrompt: onBeforePromptSetup,
        promptTemplate: (ctx) => {
          const runArtifactDir = resolvePromptRunArtifactDir(ctx);
          return [
            'Use the `bash` tool to run the `agent-browser` CLI. This is your browser access for this run.',
            '',
            `Task: ${ctx.scenario.task}`,
            '',
            `Session: ${ctx.opencode.sessionID}`,
            `Scenario URL (already opened): ${ctx.scenario.url}`,
            '',
            'Boundaries you must follow:',
            '- Use only tools: `bash` + `read`.',
            `- \`bash\` may run only \`${AGENT_BROWSER} ...\` commands. Do not run other shell commands or scripting.`,
            `- \`read\` may open only screenshots for this run under "${runArtifactDir}/step-*.png", including warmup step-00.`,
            '- The page is already opened and chart-ready before this turn starts. Do not spend turns on setup dance.',
            '- Treat the repository, local filesystem, and run artifacts as off-limits.',
            '- Finish by producing the "Final answer" section below. Answer can be `null`.',
            '- If you are stuck, output `null` early rather than waiting for timeout.',
            '',
            ...dataProvenanceGuardrails(),
            '',
            ...humanTraceabilityGuidance(),
            '',
            ...agentBrowserEfficiencyGuidance(ctx, { preopened: true }),
            '',
            ...snapshotDomEfficiencyGuidance(),
            '',
            ...finalAnswerFormatBlock(ctx),
          ].join('\n');
        },
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
      const url = buildScenarioUrl({
        route: scenario.route,
        hash: scenario.hash,
        query: { 'expose-bridge': '1', 'vacp-dom-snapshot': '0', 'vacp-debug': '0' },
      });
      jobs.push({
        experiment: 'pure-vacp',
        model,
        scenario: { id: scenario.id, url, task: scenario.task, responseFormat: scenario.responseFormat },
        toolPolicy: {
          mode: 'allow',
          ids: [
            `functions.${tools.openUrl}`,
            `functions.${tools.capabilities}`,
            `functions.${tools.state}`,
            `functions.${tools.execute}`,
          ],
        },
        mcp: {
          servers: { [VACP_MCP_SERVER_NAME]: buildVacpMcpServerConfig(url) },
          allow: [],
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
            '- The scenario URL is already open and VACP bridge readiness is handled before your turn starts.',
            '- In this run, you cannot take screenshots.',
            '- Do not spend tokens on setup dance. Call `vacp_open_url` only if recovery is necessary after an explicit navigation failure.',
            '- Start solving by reading both `vacp_capabilities` and `vacp_state` before any actions.',
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
        toolPolicy: {
          mode: 'allow',
          ids: [
            'functions.read',
            `functions.${tools.openUrl}`,
            `functions.${tools.capabilities}`,
            `functions.${tools.state}`,
            `functions.${tools.execute}`,
            `functions.${tools.screenshot}`,
            `functions.${tools.eval}`,
            `functions.${tools.waitForSelector}`,
            `functions.${tools.click}`,
            `functions.${tools.fill}`,
            `functions.${tools.press}`,
            `functions.${tools.sleep}`,
          ],
        },
        mcp: {
          servers: {
            [VACP_TOOLKIT_MCP_SERVER_NAME]: buildVacpToolkitMcpServerConfig(url),
          },
          allow: [],
        },
        onBeforePrompt: onBeforePromptSetup,
        promptTemplate: (ctx) => {
          const runArtifactDir = resolvePromptRunArtifactDir(ctx);
          return [
            'Use VACP semantic tools plus browser-control tools backed by Playwright.',
            '',
            `Task: ${ctx.scenario.task}`,
            '',
            'Hard constraints you must follow:',
            '- Treat the repository, local filesystem, and run artifacts as off-limits.',
            `- Do NOT use the \`read\` tool on anything except screenshots for this run under "${runArtifactDir}/step-*.png", including warmup step-00.`,
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
            'Important:',
            '- The scenario URL is already open and chart-ready before your turn starts.',
            `- Do not call \`${tools.openUrl}\` unless recovery is necessary after an explicit navigation failure.`,
            '',
            ...fullToolkitScreenshotGuidance({
              runArtifactDir,
              screenshotTool: tools.screenshot,
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
          ].join('\n');
        },
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
  outDir: DEFAULT_RUN_OUT_DIR,
  worktreeRoot: false,
  autoApprove: 'always',
  autoQuestion: 'reject',
  concurrency: { runs: 4 },
  timeouts: {
    setupMs: positiveIntOr(AGENT_BROWSER_SETUP_OPEN_TIMEOUT_MS + AGENT_BROWSER_SETUP_WAIT_TIMEOUT_MS + 10_000, 90_000),
    promptMs: 20 * 60_000,
  },
  server: {
    mode: 'connect',
  },
  onFinished: closeAgentBrowserSession,
  runs,
};

export default config;
