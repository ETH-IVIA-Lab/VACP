import type { ArenaConfig, ArenaJob } from './src/types';
import { execSync } from 'node:child_process';

// output of agent-browser --help to include in prompts and prevent models spending turns asking for it
const AGENT_BROWSER_HELP = execSync('npx -y agent-browser --help', { encoding: 'utf-8' }).trimStart().trimEnd();

const EXAMPLES_HUB_BASE_URL = 'http://127.0.0.1:5173';
const MODELS = [
  { providerID: 'openai', modelID: 'gpt-5.2' },
  { providerID: 'openai', modelID: 'gpt-5.2-codex' },
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

const runs: ArenaJob[] = [...buildBaselineJobs(), ...buildSnapshotInjectedJobs()];

export const config: ArenaConfig = {
  worktreeRoot: true,
  autoApprove: 'always',
  concurrency: { runs: 4 },
  runs,
};

export default config;
