import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArenaConfig, ArenaJob } from './src/types';
import { mcpToolId } from './src/opencode-ids';

const BASE_URL = 'http://127.0.0.1:5173';
const DEFAULT_MCP_TIMEOUT_MS = 120_000;
const AGENT_BROWSER = 'agent-browser';
const CHART_READY_SELECTOR = '#app canvas, #app svg, #chart canvas, #chart svg';
const CHART_READY_SCREENSHOT_NAME = 'step-00.png';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const MODELS = [
  { providerID: 'openai', modelID: 'gpt-5.2' },
  { providerID: 'openai', modelID: 'gpt-5.2-codex' },
  { providerID: 'openai', modelID: 'gpt-5.1-codex-mini' },
  { providerID: 'openai', modelID: 'gpt-5.1-codex-max' },
  { providerID: 'github-copilot', modelID: 'claude-haiku-4.5' },
  { providerID: 'github-copilot', modelID: 'claude-sonnet-4.5' },
  { providerID: 'github-copilot', modelID: 'gemini-3-flash-preview' },
];

const SCENARIO_BASES = [
  {
    id: 'vl-global-development-t1-lifeexp-max-2000',
    route: '/vega-lite/',
    hash: 'global-development',
    task: 'Which country had the highest life expectancy in 2000?',
    responseFormat: "{country: string, lifeExpectancy: number}",
  },
  {
    id: 'vl-global-development-t2-fertility-1p5-2-2000',
    route: '/vega-lite/',
    hash: 'global-development',
    task: 'Which countries in year 2000 have the fertility (children per woman) between 1.5-2?',
    responseFormat: "{countries: Array<string>}",
  },
  {
    id: 'vl-global-development-t3-largest-lowest-lifeexp-2000',
    route: '/vega-lite/',
    hash: 'global-development',
    task: 'Which of the largest countries in the world had the lowest life expectancy in 2000?',
    responseFormat: "{country: string, lifeExpectancy: number}",
  },
  {
    id: 'vl-seattle-weather-t1-sun-vs-rain-feb-apr-aug-oct',
    route: '/vega-lite/',
    hash: 'seattle-weather',
    task: 'Please compare the amount of rainy and sunny days in the range of Februry-April and August-October. Which range has more sunny days, which has more rainy days?',
    responseFormat: "{moreSunnyRange: string, moreRainyRange: string}",
  },
  {
    id: 'vl-seattle-weather-t2-extreme-temp-by-weather',
    route: '/vega-lite/',
    hash: 'seattle-weather',
    task: 'Determine the extreme temp_max values associated with rain, sun, snow.',
    responseFormat: "{rainTempMax: number, sunTempMax: number, snowTempMax: number}",
  },
  {
    id: 'vl-seattle-weather-t3-snow-season-temp-range',
    route: '/vega-lite/',
    hash: 'seattle-weather',
    task: 'Examine when snow occurs in the year and the corresponding temperature ranges.',
    responseFormat: "{observations: Array<{month: string, tempMin: number, tempMax: number}>}",
  },
  {
    id: 'mosaic-athletes-t1-regression-football-vs-cycling',
    route: '/mosaic/',
    hash: 'athletes',
    task: 'Compare the male athletes of football and cycling. For which sport is the regression line steeper?',
    responseFormat: "{steeperSport: string}",
  },
  {
    id: 'mosaic-athletes-t2-top3-tallest-female',
    route: '/mosaic/',
    hash: 'athletes',
    task: 'Name three tallest female athletes and their height.',
    responseFormat: "{tallestFemales: Array<{name: string, height: number}>}",
  },
  {
    id: 'mosaic-athletes-t3-female-judo-100-120kg-count',
    route: '/mosaic/',
    hash: 'athletes',
    task: 'How many female judo practitioners are between 100 and 120 kg?',
    responseFormat: "{count: number}",
  },
  {
    id: 'vl-airports-t1-nd-most-outgoing-top-destination',
    route: '/vega-lite/',
    hash: 'airports',
    task: 'Find in state ND (North Dakota) the airport with the most outgoing flight connections. Which airport are the most flights to?',
    responseFormat: "{airport: string, topDestination: string}",
  },
  {
    id: 'vl-airports-t2-bangor-to-denver',
    route: '/vega-lite/',
    hash: 'airports',
    task: 'Is it possible to fly from airport Bangor International (State ME, Maine) to airport Denver Intl (CO, Colorado) without transfer?',
    responseFormat: "{isPossible: boolean}",
  },
  {
    id: 'vl-airports-t3-nm-airports-smallest-outgoing-flights',
    route: '/vega-lite/',
    hash: 'airports',
    task: 'How many airports are there in state New Mexico (NM)? How many outgoing flights does the smalles airport of these have?',
    responseFormat: "{count: number, smallestOutgoingFlights: number}",
  },
  {
    id: 'cars-parcoords-t1-cylinders-4-weight-range',
    route: '/cars-parcoords/',
    task: 'Select cylinders 4, what is the range of the weight of the cars',
    responseFormat: "{minWeight: number, maxWeight: number}",
  },
  {
    id: 'cars-parcoords-t2-largest-positive-correlation',
    route: '/cars-parcoords/',
    task: 'Which dimensions do have the largest positive correlation',
    responseFormat: "{dimensions: [string, string]}",
  },
  {
    id: 'cars-parcoords-t3-cylinders-6-horsepower-outliers',
    route: '/cars-parcoords/',
    task: 'Given the cars with 6 zylinders identify outliers with respect to the horse power dimension',
    responseFormat: "{outliers: Array<{name: string, horsepower: number}>}",
  },
];

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
            'Use the `agent-browser` CLI to interact with the application and answer the task.',
            '',
            `Task: ${ctx.scenario.task}`,
            '',
            'Rules:',
            '- Do not start solving until a chart is visibly rendered (not a blank/loading screen).',
            '- Do NOT reload/refresh/re-open the page while waiting for the initial chart render.',
            `- Chart-ready sentinel: write "${ctx.run.outDir}/${CHART_READY_SCREENSHOT_NAME}" and READ it; only proceed once the chart is clearly visible.`,
            `- Visual grounding: after each meaningful interaction, write and READ "${ctx.run.outDir}/step-01.png", "step-02.png", ... (two digits). Use the screenshots to decide next actions.`,
            '',
            'Start:',
            `- Open: \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} open '${ctx.scenario.url}'\``,
            `- Wait (minimum 5s): \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} wait 5000\``,
            `- Wait for chart render: \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} wait "${CHART_READY_SELECTOR}"\``,
            `- Screenshot (chart-ready sentinel): \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} screenshot --full "${ctx.run.outDir}/${CHART_READY_SCREENSHOT_NAME}"\``,
            `- Verify (read screenshot): use the \`read\` tool on "${ctx.run.outDir}/${CHART_READY_SCREENSHOT_NAME}". If the chart is not visible yet, wait 5s and overwrite step-00.png again (no reload) until it is.`,
            `- Screenshot (after each interaction): \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} screenshot --full "${ctx.run.outDir}/step-01.png"\` (then step-02.png, step-03.png, ...)`,
            '',
            'Final answer (must follow, exact formatting):',
            `- Answer: on its own line, then output formatted JSON on the following lines inside \`\`\`json fences\`\`\` (start with \`\`\`json and end with \`\`\`), matching \`${ctx.scenario.responseFormat}\`.`,
            '- Reasoning: 1-3 sentences (brief) on its own line after the Answer JSON fence (do not include reasoning inside the JSON).',
            '- If you cannot solve: say so explicitly, output `null` as the JSON value for Answer (still inside the ```json fences), and explain why you failed / what blocked you.',
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
        experiment: 'withsnapshot',
        model,
        scenario: {
          id: scenario.id,
          url: buildScenarioUrl({
            route: scenario.route,
            hash: scenario.hash,
            query: { 'expose-bridge': '1', 'vacp-dom-snapshot': '1', 'vacp-debug': '0' },
          }),
          task: scenario.task,
          responseFormat: scenario.responseFormat,
        },
        toolPolicy: { mode: 'allow', ids: ['functions.bash', 'functions.read'] },
        promptTemplate: (ctx) =>
          [
            'Use the `agent-browser` CLI to interact with the application and answer the task.',
            'Note: a semantic snapshot is available in the DOM as:',
            '- `<script id="__vacp_snapshot" type="application/json">{...}</script>`',
            '',
            `Task: ${ctx.scenario.task}`,
            '',
            'Rules:',
            '- Do not start solving until a chart is visibly rendered (not a blank/loading screen).',
            '- Do NOT reload/refresh/re-open the page while waiting for the initial chart render.',
            `- Chart-ready sentinel: write "${ctx.run.outDir}/${CHART_READY_SCREENSHOT_NAME}" and READ it; only proceed once the chart is clearly visible.`,
            `- Visual grounding: after each meaningful interaction, write and READ "${ctx.run.outDir}/step-01.png", "step-02.png", ... (two digits). Use the screenshots to decide next actions.`,
            '',
            'Start:',
            `- Open: \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} open '${ctx.scenario.url}'\``,
            `- Wait (minimum 5s): \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} wait 5000\``,
            `- Wait for chart render: \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} wait "${CHART_READY_SELECTOR}"\``,
            `- Screenshot (chart-ready sentinel): \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} screenshot --full "${ctx.run.outDir}/${CHART_READY_SCREENSHOT_NAME}"\``,
            `- Verify (read screenshot): use the \`read\` tool on "${ctx.run.outDir}/${CHART_READY_SCREENSHOT_NAME}". If the chart is not visible yet, wait 5s and overwrite step-00.png again (no reload) until it is.`,
            `- Screenshot (after each interaction): \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} screenshot --full "${ctx.run.outDir}/step-01.png"\` (then step-02.png, step-03.png, ...)`,
            '',
            'Final answer (must follow, exact formatting):',
            `- Answer: on its own line, then output formatted JSON on the following lines inside \`\`\`json fences\`\`\` (start with \`\`\`json and end with \`\`\`), matching \`${ctx.scenario.responseFormat}\`.`,
            '- Reasoning: 1-3 sentences (brief) on its own line after the Answer JSON fence (do not include reasoning inside the JSON).',
            '- If you cannot solve: say so explicitly, output `null` as the JSON value for Answer (still inside the ```json fences), and explain why you failed / what blocked you.',
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
            'Important:',
            '- Do not start solving until the app is ready. In this run, you cannot take screenshots.',
            '- Do NOT spam/retry `vacp_open_url` in a loop (that reloads). Call it once with `wait_for_bridge=true` and a sufficiently large `timeout_ms`.',
            '- Verify readiness by successfully calling `vacp_open_url` and then reading both `vacp_capabilities` and `vacp_state` before any actions.',
            '',
            'Interaction style (must follow):',
            '- Solve the task by gradually changing the visualization state, like a human partner would (set params, apply selections, hover for tooltips).',
            '- Do NOT jump straight to computations/data extraction before you have set the relevant params/selections in the app.',
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
            'Final answer (must follow, exact formatting):',
            `- Answer: on its own line, then output formatted JSON on the following lines inside \`\`\`json fences\`\`\` (start with \`\`\`json and end with \`\`\`), matching \`${ctx.scenario.responseFormat}\`.`,
            '- Reasoning: 1-3 sentences (brief) on its own line after the Answer JSON fence (do not include reasoning inside the JSON).',
            '- If you cannot solve: say so explicitly, output `null` as the JSON value for Answer (still inside the ```json fences), and explain why you failed / what blocked you.',
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
            `Start by calling \`${tools.openUrl}\` with: ${ctx.scenario.url}`,
            '',
            'Chart-ready sentinel (must do before solving):',
            `- Sleep (minimum 5s): call \`${tools.sleep}\` with ms=5000.`,
            `- Wait for chart render: call \`${tools.waitForSelector}\` with selector "${CHART_READY_SELECTOR}" (increase timeout if needed).`,
            `- Screenshot (sentinel): call \`${tools.screenshot}\` with path "${ctx.run.outDir}/${CHART_READY_SCREENSHOT_NAME}".`,
            `- Visual check: use the \`read\` tool on "${ctx.run.outDir}/${CHART_READY_SCREENSHOT_NAME}" and confirm the chart is visibly rendered.`,
            `- If not visible yet: sleep 5s, wait again, and overwrite step-00.png (no reload/refresh/re-open). Repeat until visible.`,
            `- Once visible: call \`${tools.capabilities}\` and \`${tools.state}\` to see available interactions and the current semantic state.`,
            '',
            'Interaction style (must follow):',
            '- Solve the task by gradually changing the app state through human-like interactions (sliders, selections/brushes, hover tooltips, zoom/pan).',
            '- Do NOT jump straight to computations/data extraction before interacting; first drive the viz into the right state (e.g. year=2000, relevant selection applied).',
            `- After each meaningful interaction:`,
            `  - Screenshot: call \`${tools.screenshot}\` with "${ctx.run.outDir}/step-01.png" (then step-02.png, step-03.png, ...; two digits).`,
            `  - Read the screenshot for visual grounding, then verify via \`${tools.state}\` before proceeding.`,
            '',
            'Preferred tools:',
            `- Use \`${tools.capabilities}\`, \`${tools.state}\`, \`${tools.execute}\` for semantic operations whenever possible.`,
            `- Use browser tools (\`${tools.click}\`, \`${tools.fill}\`, \`${tools.press}\`, \`${tools.eval}\`) only when needed for interactions not exposed semantically.`,
            `- Keep \`${tools.eval}\` for UI plumbing/debugging; do not use it to shortcut the task by scraping raw data and computing immediately.`,
            '',
            'If the required interaction is not available via VACP actions, state what capability is missing.',
            '',
            'Final answer (must follow, exact formatting):',
            `- Answer: on its own line, then output formatted JSON on the following lines inside \`\`\`json fences\`\`\` (start with \`\`\`json and end with \`\`\`), matching \`${ctx.scenario.responseFormat}\`.`,
            '- Reasoning: 1-3 sentences (brief) on its own line after the Answer JSON fence (do not include reasoning inside the JSON).',
            '- If you cannot solve: say so explicitly, output `null` as the JSON value for Answer (still inside the ```json fences), and explain why you failed / what blocked you.',
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

const runs: ArenaJob[] = [
  ...buildBaselineJobs(),
  ...buildSnapshotInjectedJobs(),
  ...buildPureVACPJobs(),
  ...buildFullToolkitJobs(),
];

export const config: ArenaConfig = {
  worktreeRoot: true,
  autoApprove: 'always',
  concurrency: { runs: 8 },
  server: { mode: 'connect' },
  runs,
};

export default config;
