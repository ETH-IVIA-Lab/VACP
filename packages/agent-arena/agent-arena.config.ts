import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArenaConfig, ArenaJob } from './src/types';
import { mcpToolId } from './src/opencode-ids';

const BASE_URL = 'http://127.0.0.1:5173';
const DEFAULT_MCP_TIMEOUT_MS = 120_000;
const AGENT_BROWSER = 'agent-browser';
const CHART_READY_SELECTOR = '#app canvas, #app svg, #chart canvas, #chart svg';
const CHART_READY_SCREENSHOT_NAME = '00-chart-ready.png';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const MODELS = [
  { providerID: 'openai', modelID: 'gpt-5.2' },
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
            '- Do NOT reload/refresh/re-open the page during the chart-ready wait; that can cause an infinite loop.',
            '- You MUST verify the initial render by taking a screenshot and then reading that image file.',
            '- Do not perform any interaction step until you have visually verified a rendered chart in the screenshot.',
            '- If at any point the UI becomes blank/loading, stop and redo the wait + overwrite 00-chart-ready.png + read loop before continuing.',
            '- After each interaction, take a full-page screenshot to the run directory.',
            '',
            'Start:',
            `- Open: \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} open '${ctx.scenario.url}'\``,
            `- Wait (minimum 5s): \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} wait 5000\``,
            `- Wait for chart render: \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} wait "${CHART_READY_SELECTOR}"\``,
            `- Screenshot (chart-ready): \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} screenshot --full "${ctx.run.outDir}/${CHART_READY_SCREENSHOT_NAME}"\``,
            `- Verify (read screenshot): use the \`read\` tool on "${ctx.run.outDir}/${CHART_READY_SCREENSHOT_NAME}" and confirm the chart is visible.`,
            `  - If the chart is not visible yet, repeat the wait + screenshot + read loop until it is.`,
            `  - Always wait at least 5s between retries: \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} wait 5000\``,
            `  - Always overwrite "${ctx.run.outDir}/${CHART_READY_SCREENSHOT_NAME}" while waiting; do not create step-*.png until the chart is visible.`,
            `- Screenshot (after each interaction): \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} screenshot --full "${ctx.run.outDir}/step-{n}.png"\``,
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
            '- Do NOT reload/refresh/re-open the page during the chart-ready wait; that can cause an infinite loop.',
            '- You MUST verify the initial render by taking a screenshot and then reading that image file.',
            '- Do not perform any interaction step until you have visually verified a rendered chart in the screenshot.',
            '- If at any point the UI becomes blank/loading, stop and redo the wait + overwrite 00-chart-ready.png + read loop before continuing.',
            '',
            'Start:',
            `- Open: \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} open '${ctx.scenario.url}'\``,
            `- Wait (minimum 5s): \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} wait 5000\``,
            `- Wait for chart render: \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} wait "${CHART_READY_SELECTOR}"\``,
            `- Screenshot (chart-ready): \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} screenshot --full "${ctx.run.outDir}/${CHART_READY_SCREENSHOT_NAME}"\``,
            `- Verify (read screenshot): use the \`read\` tool on "${ctx.run.outDir}/${CHART_READY_SCREENSHOT_NAME}" and confirm the chart is visible.`,
            `  - If the chart is not visible yet, repeat the wait + screenshot + read loop until it is.`,
            `  - Always wait at least 5s between retries: \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} wait 5000\``,
            `  - Always overwrite "${ctx.run.outDir}/${CHART_READY_SCREENSHOT_NAME}" while waiting; do not create step-*.png until the chart is visible.`,
            `- Screenshot (after each interaction): \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} screenshot --full "${ctx.run.outDir}/step-{n}.png"\``,
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
            `Start by calling \`${tools.openUrl}\` with: ${ctx.scenario.url}`,
            '',
            'Then:',
            `- Call \`${tools.capabilities}\` and use it as the source of truth for actions and schemas.`,
            `- Call \`${tools.state}\` to understand the current semantic state.`,
            `- Call \`${tools.execute}\` to perform one semantic operation at a time.`,
            `- After each action, call \`${tools.state}\` again to verify the effect.`,
            '',
            'If the required interaction is not available via VACP actions, state what capability is missing.',
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
            'Before solving (must do):',
            `- Sleep (minimum 5s): call \`${tools.sleep}\` with ms=5000.`,
            `- Wait for chart render: call \`${tools.waitForSelector}\` with selector "${CHART_READY_SELECTOR}" (increase timeout if needed).`,
            `- Screenshot (chart-ready): call \`${tools.screenshot}\` with path "${ctx.run.outDir}/${CHART_READY_SCREENSHOT_NAME}".`,
            `- Verify (read screenshot): use the \`read\` tool on "${ctx.run.outDir}/${CHART_READY_SCREENSHOT_NAME}" and confirm the chart is visible.`,
            `  - If the chart is not visible yet, repeat wait + screenshot + read until it is.`,
            `  - Always sleep at least 5s between retries (call \`${tools.sleep}\` with ms=5000).`,
            `  - Do NOT reload/refresh/re-open the page while waiting; keep waiting and keep overwriting "${ctx.run.outDir}/${CHART_READY_SCREENSHOT_NAME}" until it is visible.`,
            `- Do not proceed with any interaction step until the screenshot verification shows an actually rendered chart.`,
            '',
            'Preferred interaction:',
            `- Use \`${tools.capabilities}\`, \`${tools.state}\`, \`${tools.execute}\` for semantic operations whenever possible.`,
            `- Use browser tools (\`${tools.click}\`, \`${tools.fill}\`, \`${tools.press}\`, \`${tools.eval}\`) only when needed.`,
            '',
            'Evidence:',
            `- After each meaningful interaction, call \`${tools.screenshot}\` to write "${ctx.run.outDir}/step-{n}.png"`,
            `- The directory "${ctx.run.outDir}" already exists.`,
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
