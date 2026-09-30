import { existsSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import suite from '../evals.config';
import { openGallery } from './adapters/browser/host';
import { createTracing } from './adapters/telemetry';
import type { Scenario } from './core/scenario';
import { drawSplit, splitOf } from './core/split';
import { EvalGateError } from './results/gate';
import { flowsIn, type Flow } from './results/layout';
import { regradeFlow } from './results/regrade';
import { flowTable } from './results/summary';
import { auditScenarios } from './run/audit';
import { runFlow } from './run/flow';
import { auditGold } from './run/gold';
import { EvalBugError } from './run/run';

const usage = `eval <command> [options]

  list                     Scenarios with their capability, source, and split
  inputs                   Every scenario as markdown, for review before a paid run
  inspect <page|path>      Live actions and state refs of a page, for writing scenarios
  split [--seed N]         Draw the fixed train/test split (once)
  audit [--gold]           Oracle and control runs over every scenario, and with --gold, answers re-derived from data
  run                      Run one flow: --condition, --model, --variant, --reps, --concurrency
  regrade                  Grade recorded runs again with the current checks (needs --approve-eval)
  summary                  Status table per flow, recomputed from results

Flows:     --condition <id> (default ${suite.defaultCondition})  --model <key> (default ${suite.defaultModel})
           regrade and summary cover every flow unless --condition or --model narrows them
Tracing:   spans land in each variant's spans.jsonl, metadata only unless --trace-content,
           and also go to OTEL_EXPORTER_OTLP_ENDPOINT when it is set
Selection: --only <id|prefix,...>  --tag <tag>  --split train|test|all
Serving:   --base-url <url> (default: serve the gallery ${suite.run.serve} on port ${suite.run.port})`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    condition: { type: 'string' },
    model: { type: 'string' },
    variant: { type: 'string', default: 'baseline' },
    reps: { type: 'string' },
    concurrency: { type: 'string' },
    only: { type: 'string' },
    tag: { type: 'string' },
    split: { type: 'string', default: 'all' },
    seed: { type: 'string', default: '20260929' },
    'base-url': { type: 'string' },
    'approve-eval': { type: 'boolean', default: false },
    'trace-content': { type: 'boolean', default: false },
    gold: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

const controller = new AbortController();
// The first signal ends every run and stops the servers this process started. A second one exits at
// once, through the exit hooks that end the sandboxes' processes.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
  process.on(signal, () => {
    if (controller.signal.aborted) process.exit(130);
    controller.abort(new Error('Interrupted'));
  });
const log = (line: string) => console.log(line);

function count(option: 'reps' | 'concurrency'): number | undefined {
  const value = values[option];
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`--${option} must be a positive integer, received ${value}`);
  return parsed;
}

function selected(): Scenario[] {
  const only = values.only
    ?.split(',')
    .map((each) => each.trim())
    .filter(Boolean);
  const split = suite.split();
  if (values.split !== 'all' && !split) throw new Error(`No split at ${suite.splitFile}. Run \`eval split\` first.`);
  const picked = suite.scenarios.filter(
    (scenario) =>
      (!only || only.some((id) => scenario.id === id || scenario.id.startsWith(`${id}/`) || scenario.page.id === id)) &&
      (!values.tag || scenario.tags.includes(values.tag)) &&
      (values.split === 'all' || splitOf(split, scenario.id) === values.split),
  );
  if (!picked.length) throw new Error('No scenario matches the selection');
  return picked;
}

function fence(text: string) {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks}\n${text}\n${ticks}`;
}

function inputs(scenarios: readonly Scenario[]) {
  const split = suite.split();
  return [
    `# VACP eval inputs (${scenarios.length} scenarios)`,
    '',
    '| id | page | tags | source | split | turns | checks |',
    '|---|---|---|---|---|---|---|',
    ...scenarios.map(
      (scenario) =>
        `| ${scenario.id} | ${scenario.page.id} | ${scenario.tags.join(', ')} | ${scenario.source} | ${splitOf(split, scenario.id)} | ${scenario.turns.length} | ${scenario.turns.reduce((sum, turn) => sum + turn.expect.length, 0)} |`,
    ),
    '',
    ...scenarios.flatMap((scenario) => [
      `## ${scenario.id}`,
      '',
      `Page \`${scenario.page.path}\` · ${scenario.tags.join(', ')} · ${scenario.source}`,
      '',
      `Why it is hard: ${scenario.why}`,
      '',
      ...(scenario.setup.length ? [`Setup: ${scenario.setup.map((step) => `\`${step.action}\``).join(', ')}`, ''] : []),
      ...scenario.turns.flatMap((turn, index) => [
        `### Turn ${index + 1}`,
        '',
        fence(turn.say),
        '',
        ...turn.expect.map((check) => `- ${check.kind} (${check.assertion.severity}): ${check.label}`),
        '',
        `Reference answer: ${turn.oracle.answer}`,
        '',
      ]),
    ]),
  ].join('\n');
}

async function inspect(target: string) {
  const path = target.startsWith('/')
    ? target
    : suite.scenarios.find((scenario) => scenario.page.id === target)?.page.path;
  if (!path)
    throw new Error(`No scenario uses page "${target}". Pass a gallery path such as /vega-lite/#airports instead.`);
  const gallery = await openGallery({
    ...suite.run,
    repoRoot: suite.repoRoot,
    baseURL: values['base-url'],
    signal: controller.signal,
  });
  try {
    const { page, close } = await gallery.open(path, controller.signal);
    try {
      const graph = await page.graph();
      console.log(`# ${path}\n\n## Actions`);
      for (const action of graph.actions)
        console.log(
          `- ${action.name}  [${action.operation?.contract ?? action.operation?.kind}]  ${Object.keys((action.parameters as { properties?: object })?.properties ?? {}).join(', ')}`,
        );
      console.log('\n## State');
      for (const [ref, value] of Object.entries(await page.state()))
        console.log(`- ${ref}: ${JSON.stringify(value).slice(0, 200)}`);
      console.log(`\n## WebMCP tools: ${(await page.tools()).length}`);
    } finally {
      await close();
    }
  } finally {
    await gallery.close();
  }
}

/** The flows `--condition` and `--model` pick out of the recorded ones, or all of them. */
function recordedFlows(): Flow[] {
  const flows = flowsIn(suite.results).filter(
    (flow) =>
      (!values.condition || flow.condition === values.condition) && (!values.model || flow.model === values.model),
  );
  if (!flows.length) throw new Error('No recorded flow matches --condition and --model');
  return flows;
}

async function main(tracing: ReturnType<typeof createTracing>) {
  const [command, ...rest] = positionals;
  if (values.help || !command) return console.log(usage);
  switch (command) {
    case 'list': {
      const split = suite.split();
      for (const scenario of selected())
        console.log(
          `${scenario.id.padEnd(44)} ${scenario.tags[0].padEnd(12)} ${scenario.source.padEnd(13)} ${splitOf(split, scenario.id)}`,
        );
      return;
    }
    case 'inputs':
      return console.log(inputs(selected()));
    case 'inspect':
      return inspect(rest[0] ?? '');
    case 'split': {
      if (existsSync(suite.splitFile) && !values.force)
        throw new Error(
          `${suite.splitFile} exists. Splits are fixed once, so pass --force only before any flow is scored.`,
        );
      const split = drawSplit(suite.scenarios, Number(values.seed));
      writeFileSync(suite.splitFile, `${JSON.stringify(split, null, 2)}\n`);
      return console.log(`train ${split.train.length}, test ${split.test.length} (seed ${split.seed})`);
    }
    case 'audit': {
      if (values.gold) {
        const findings = await auditGold(suite.repoRoot, suite.scenarios);
        for (const finding of findings)
          console.log(`${finding.ok ? 'ok  ' : 'FAIL'} ${finding.scenario}: ${finding.detail}`);
        const failed = findings.filter((finding) => !finding.ok).length;
        console.log(`\n${findings.length - failed}/${findings.length} gold derivations agree with the data`);
        if (failed) process.exitCode = 1;
        return;
      }
      const problems = await auditScenarios({
        suite,
        tracing,
        scenarios: selected(),
        baseURL: values['base-url'],
        log,
        signal: controller.signal,
      });
      if (problems) process.exitCode = 1;
      return;
    }
    case 'run': {
      const { flow } = await runFlow({
        suite,
        tracing,
        condition: values.condition ?? suite.defaultCondition,
        model: values.model,
        variant: values.variant!,
        reps: count('reps'),
        concurrency: count('concurrency'),
        scenarios: selected(),
        baseURL: values['base-url'],
        approveEval: values['approve-eval'],
        traceContent: values['trace-content'],
        log,
        signal: controller.signal,
      });
      return console.log(`\n${flowTable(suite.results, flow)}`);
    }
    case 'regrade': {
      if (!values['approve-eval'])
        throw new EvalGateError(
          'Regrading re-bases each flow on the current checks. Review them, then pass --approve-eval.',
        );
      for (const flow of recordedFlows()) await regradeFlow(suite, flow, log);
      return;
    }
    case 'summary':
      for (const flow of recordedFlows()) console.log(`${flowTable(suite.results, flow)}\n`);
      return;
    default:
      console.log(usage);
      process.exitCode = 2;
  }
}

const tracing = createTracing();
main(tracing)
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = error instanceof EvalGateError ? 2 : error instanceof EvalBugError ? 3 : 1;
  })
  // Spans already sit in each run's spans.jsonl, so a collector that refuses the last batch costs only
  // its copy of them.
  .finally(() =>
    tracing.shutdown().catch((error: unknown) => {
      console.error(`${tracing.otlp} refused the last spans: ${error instanceof Error ? error.message : error}`);
    }),
  );
