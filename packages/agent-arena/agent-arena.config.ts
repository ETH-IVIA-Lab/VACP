import type { ArenaConfig, ArenaJob } from './src/types';
import { execSync } from 'node:child_process';
import path from 'node:path';

// output of agent-browser --help to include in prompts and prevent models spending turns asking for it
const AGENT_BROWSER_HELP = execSync('npx -y agent-browser --help', { encoding: 'utf-8' }).trimStart().trimEnd();

const EXAMPLES_HUB_BASE_URL = 'http://127.0.0.1:5173';
const REPO_ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();

function sanitizeMcpSegment(value: string): string {
  // Must match OpenCode's MCP tool ID sanitization (server + tool name).
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function mcpToolId(serverName: string, toolName: string): string {
  return `${sanitizeMcpSegment(serverName)}_${sanitizeMcpSegment(toolName)}`;
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
  '--url',
  `${EXAMPLES_HUB_BASE_URL}/`,
];

const VACP_MCP_SERVER_CONFIG = {
  type: 'local',
  command: [...VACP_MCP_BASE_COMMAND],
  timeout: 120_000,
  environment: {
    PYTHONUNBUFFERED: '1',
  },
} as const;

const VACP_TOOLKIT_MCP_SERVER_CONFIG = {
  type: 'local',
  command: [...VACP_MCP_BASE_COMMAND, '--enable-browser-tools'],
  timeout: 120_000,
  environment: {
    PYTHONUNBUFFERED: '1',
  },
} as const;
const MODELS = [
  { providerID: 'openai', modelID: 'gpt-5.2' },
];
const SCENARIO_BASES = [
  {
    id: 'vl-global-development-t1-lifeexp-max-2000',
    route: '/vega-lite/',
    hash: 'global-development',
    task: 'Which country had the highest life expectancy in 2000?',
  },
  {
    id: 'vl-global-development-t2-fertility-1p5-2-2000',
    route: '/vega-lite/',
    hash: 'global-development',
    task: 'Which countries in year 2000 have the fertility (children per woman) between 1.5-2?',
  },
  {
    id: 'vl-global-development-t3-largest-lowest-lifeexp-2000',
    route: '/vega-lite/',
    hash: 'global-development',
    task: 'Which of the largest countries in the world had the lowest life expectancy in 2000?',
  },
  {
    id: 'vl-seattle-weather-t1-sun-vs-rain-feb-apr-aug-oct',
    route: '/vega-lite/',
    hash: 'seattle-weather',
    task: 'Please compare the amount of rainy and sunny days in the range of Februry-April and August-October. Which range has more sunny days, which has more rainy days?',
  },
  {
    id: 'vl-seattle-weather-t2-extreme-temp-by-weather',
    route: '/vega-lite/',
    hash: 'seattle-weather',
    task: 'Determine the extreme temp_max values associated with rain, sun, snow.',
  },
  {
    id: 'vl-seattle-weather-t3-snow-season-temp-range',
    route: '/vega-lite/',
    hash: 'seattle-weather',
    task: 'Examine when snow occurs in the year and the corresponding temperature ranges.',
  },
  {
    id: 'mosaic-athletes-t1-regression-football-vs-cycling',
    route: '/mosaic/',
    hash: 'athletes',
    task: 'Compare the male athletes of football and cycling. For which sport is the regression line steeper?',
  },
  {
    id: 'mosaic-athletes-t2-top3-tallest-female',
    route: '/mosaic/',
    hash: 'athletes',
    task: 'Name three tallest female athletes and their height.',
  },
  {
    id: 'mosaic-athletes-t3-female-judo-100-120kg-count',
    route: '/mosaic/',
    hash: 'athletes',
    task: 'How many female judo practitioners are between 100 and 120 kg?',
  },
  {
    id: 'vl-airports-t1-nd-most-outgoing-top-destination',
    route: '/vega-lite/',
    hash: 'airports',
    task: 'Find in state ND (North Dakota) the airport with the most outgoing flight connections. Which airport are the most flights to?',
  },
  {
    id: 'vl-airports-t2-bangor-to-denver',
    route: '/vega-lite/',
    hash: 'airports',
    task: 'Is it possible to fly from airport Bangor International (State ME, Maine) to airport Denver Intl (CO, Colorado)?',
  },
  {
    id: 'vl-airports-t3-nm-airports-smallest-outgoing-flights',
    route: '/vega-lite/',
    hash: 'airports',
    task: 'How many airports are there in state New Mexico (NM)? How many outgoing flights does the smalles airport of these have?',
  },
  {
    id: 'cars-parcoords-t1-cylinders-4-weight-range',
    route: '/cars-parcoords/',
    task: 'Select cylinders 4, what is the range of the weight of the cars',
  },
  {
    id: 'cars-parcoords-t2-largest-positive-correlation',
    route: '/cars-parcoords/',
    task: 'Which dimensions do have the largest positiv correlation',
  },
  {
    id: 'cars-parcoords-t3-cylinders-6-horsepower-outliers',
    route: '/cars-parcoords/',
    task: 'Given the cars with 6 zylinders identifies outliers with respect to the horse power dimension',
  },
];

function buildScenarioUrl(args: { route: string; hash?: string; query?: Record<string, string> }): string {
  const u = new URL(args.route, EXAMPLES_HUB_BASE_URL);
  for (const [k, v] of Object.entries(args.query ?? {})) u.searchParams.set(k, v);
  if (args.hash) u.hash = args.hash.startsWith('#') ? args.hash : `#${args.hash}`;
  return u.toString();
}

function buildBaselineJobs() {
  const jobs: ArenaJob[] = [];
  for (const model of MODELS) {
    for (const scenarioBase of SCENARIO_BASES) {
      jobs.push({
        experiment: 'baseline',
        model,
        scenario: {
          id: scenarioBase.id,
          url: buildScenarioUrl({
            route: scenarioBase.route,
            hash: scenarioBase.hash,
            query: { 'expose-bridge': '0' },
          }),
          task: scenarioBase.task,
        },
        toolPolicy: {
          mode: 'allow',
          ids: ['functions.bash'],
        },
        promptTemplate: (ctx) =>
          [
            'Use the `agent-browser` CLI to interact with the application to complete the task:',
            '',
            `> ${ctx.scenario.task}`,
            '',
            `After each interaction with the application, use \`agent-browser --session ${ctx.opencode.sessionID} screenshot --full "${ctx.run.outDir}/step-{n}.png"\` to take screenshots. The directory already exists.`,
            `\`agent-browser\` is already available in your environment, so you don't need to install it or check it. Below you see the output of \`agent-browser --help\` for your reference:`,
            '',
            '```text',
            AGENT_BROWSER_HELP,
            '```',
            '',
            `Start by executing \`agent-browser --session ${ctx.opencode.sessionID} open ${ctx.scenario.url}\` to open the application, and proceed from there.`,
          ].join('\n'),
      });
    }
  }
  return jobs;
}

function buildSnapshotInjectedJobs() {
  const jobs: ArenaJob[] = [];
  for (const model of MODELS) {
    for (const scenarioBase of SCENARIO_BASES) {
      jobs.push({
        experiment: 'withsnapshot',
        model,
        scenario: {
          id: scenarioBase.id,
          url: buildScenarioUrl({
            route: scenarioBase.route,
            hash: scenarioBase.hash,
            query: { 'expose-bridge': '0', 'vacp-dom-snapshot': '1' },
          }),
          task: scenarioBase.task,
        },
        toolPolicy: {
          mode: 'allow',
          ids: ['functions.bash'],
        },
        promptTemplate: (ctx) =>
          [
            'Use the `agent-browser` CLI to interact with the application to complete the task:',
            '',
            `> ${ctx.scenario.task}`,
            '',
            'Note that there is a semantic representation of the application in `<script id="__vacp_snapshot" type="application/json">{...}</script>`',
            `After each interaction with the application, use \`agent-browser --session ${ctx.opencode.sessionID} screenshot --full "${ctx.run.outDir}/step-{n}.png"\` to take screenshots. The directory already exists.`,
            `\`agent-browser\` is already available in your environment, so you don't need to install it or check it. Below you see the output of \`agent-browser --help\` for your reference:`,
            '',
            '```text',
            AGENT_BROWSER_HELP,
            '```',
            '',
            `Start by executing \`agent-browser --session ${ctx.opencode.sessionID} open ${ctx.scenario.url}\` to open the application, and proceed from there.`,
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
    for (const scenarioBase of SCENARIO_BASES) {
      jobs.push({
        experiment: 'pure-vacp',
        model,
        scenario: {
          id: scenarioBase.id,
          url: buildScenarioUrl({
            route: scenarioBase.route,
            hash: scenarioBase.hash,
            query: { 'expose-bridge': '1' },
          }),
          task: scenarioBase.task,
        },
        toolPolicy: {
          mode: 'allow',
          ids: [],
        },
        mcp: {
          servers: {
            [VACP_MCP_SERVER_NAME]: VACP_MCP_SERVER_CONFIG,
          },
          allow: [VACP_MCP_SERVER_NAME],
        },
        promptTemplate: (ctx) =>
          [
            'Use the VACP MCP tools only (no shell, no webfetch).',
            '',
            `Task: ${ctx.scenario.task}`,
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
    for (const scenarioBase of SCENARIO_BASES) {
      jobs.push({
        experiment: 'full-toolkit',
        model,
        scenario: {
          id: scenarioBase.id,
          url: buildScenarioUrl({
            route: scenarioBase.route,
            hash: scenarioBase.hash,
            query: { 'expose-bridge': '1', 'vacp-dom-snapshot': '1', 'vacp-debug': '1' },
          }),
          task: scenarioBase.task,
        },
        toolPolicy: {
          mode: 'allow',
          ids: [],
        },
        mcp: {
          servers: {
            [VACP_TOOLKIT_MCP_SERVER_NAME]: VACP_TOOLKIT_MCP_SERVER_CONFIG,
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
  concurrency: { runs: 4 },
  runs,
};

export default config;
