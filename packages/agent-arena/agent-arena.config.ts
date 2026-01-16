import type { ArenaConfig, ArenaJob } from './src/types';
import { execSync } from 'node:child_process';

// output of agent-browser --help to include in prompts and prevent models spending turns asking for it
const AGENT_BROWSER_HELP = execSync('npx -y agent-browser --help', { encoding: 'utf-8' }).trimStart().trimEnd();

const EXAMPLES_HUB_BASE_URL = 'http://127.0.0.1:5173';
const MODELS = [{ providerID: 'openai', modelID: 'gpt-5.2' }];
const SCENARIO_BASES = [
  {
    id: 'weather-jacket',
    path: '/mosaic/#weather',
    task: 'In summer, how many days would I probably need a jacket (rain/drizzle/snow), and what percent of summer days is that?',
  },
  {
    id: 'athletes-tallest-men',
    path: '/mosaic/#athletes',
    task: 'Show me the tallest male track-and-field athletes. Who comes out on top, and what are their height and weight?',
  },
];

function buildBaselineJobs() {
  const jobs: ArenaJob[] = [];
  for (const model of MODELS) {
    for (const scenarioBase of SCENARIO_BASES) {
      jobs.push({
        experiment: 'baseline',
        model,
        scenario: {
          id: scenarioBase.id,
          url: `${EXAMPLES_HUB_BASE_URL}${scenarioBase.path}`,
          task: scenarioBase.task,
        },
        toolPolicy: {
          mode: 'allow',
          ids: ['functions.bash', 'functions.read', 'functions.glob', 'multi_tool_use.parallel'],
        },
        promptTemplate: (ctx) =>
          [
            'Use the `agent-browser` CLI to interact with the application to complete the task:',
            '',
            `> ${ctx.scenario.task}`,
            '',
            `After each interaction with the application, use \`agent-browser\` to take a screenshot and store it under "${ctx.run.outDir}/step-{n}.png". The directory already exists.`,
            `\`agent-browser\` is already available in your environment, so you don't need to install it or check it. Below you see the output of \`agent-browser --help\` for your reference:`,
            '',
            '```text',
            AGENT_BROWSER_HELP,
            '```',
            '',
            `Start by executing \`agent-browser --session ${ctx.run.sessionID} open ${ctx.scenario.url}\` to open the application, and proceed from there.`,
          ].join('\n'),
      });
    }
  }
  return jobs;
}

const runs: ArenaJob[] = [...buildBaselineJobs()];

export const config: ArenaConfig = {
  worktreeRoot: true,
  autoApprove: 'always',
  concurrency: { runs: 8 },
  runs,
};

export default config;
