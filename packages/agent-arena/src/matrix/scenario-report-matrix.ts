import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { consola } from 'consola';
import type { ArenaConfig, ArenaJob, ArenaRunResult } from '../types.js';
import { writeAggregatedMetrics } from '../logs/aggregate.js';
import { exportSessionLogs } from '../logs/export-session.js';
import { runArena } from '../runner/index.js';
import { resolveFromCwd } from '../paths.js';

const execFileAsync = promisify(execFile);

type ModelSpec = { providerID: string; modelID: string };

type ScenarioBase = { id: string; route: string; hash?: string; task: string };

type Setup = {
  id: 'S1' | 'S2' | 'S3' | 'S4';
  title: string;
  query: Record<string, string>;
  needsSnapshot: boolean;
  needsStructuredResult: boolean;
};

const DEFAULT_BASE_URL = 'http://127.0.0.1:5173';
const DEFAULT_MODEL: ModelSpec = { providerID: 'openai', modelID: 'gpt-5.2' };
const AGENT_BROWSER_VERSION = '0.7.6';

// Scenario source: matches the manual matrix run folder (15 tasks).
const SCENARIOS: ScenarioBase[] = [
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
    task: 'Determine the extreme temp_max values associated with rain, sun, snow.',
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

// Expected answers from the manual matrix run (2026-01-23).
// Used only for report generation and correctness checks (not shown to the agent).
const ANSWERS_EXPECTED: Record<string, unknown> = {
  'cars-parcoords-t1-cylinders-4-weight-range': { max_weight: 3270.0, min_weight: 1613.0, n: 207 },
  'cars-parcoords-t2-largest-positive-correlation': { corr: 0.9324746504807486, pair: ['Displacement', 'Weight'] },
  'cars-parcoords-t3-cylinders-6-horsepower-outliers': {
    max_hp: { car: 'Buick Regal Sport Coupe (turbo)', horsepower: 165.0 },
    min_hp: { car: 'Ford Maverick', horsepower: 0.0 },
    min_hp_nonzero: { car: 'Mercury Monarch', horsepower: 72.0 },
  },
  'mosaic-athletes-t1-regression-football-vs-cycling': {
    cycling: { n: 309, slope: 0.0038995435865377243 },
    football: { n: 321, slope: 0.007641221269215981 },
    steeper: 'football',
  },
  'mosaic-athletes-t2-top3-tallest-female': {
    top3: [
      { height: 2.03, name: 'Brittney Griner', sport: 'basketball' },
      { height: 2.03, name: 'Elizabeth Cambage', sport: 'basketball' },
      { height: 2.03, name: 'Linet Arasa', sport: 'rugby sevens' },
    ],
  },
  'mosaic-athletes-t3-female-judo-100-120kg-count': { count: 3 },
  'vl-airports-t1-nd-most-outgoing-top-destination': {
    nd_origin_iata: 'FAR',
    nd_origin_name: 'Hector International',
    nd_origin_routes: 7,
    top_destination_flights: 1743,
    top_destination_iata: 'MSP',
    top_destination_name: 'Minneapolis-St Paul Intl',
  },
  'vl-airports-t2-bangor-to-denver': { destination: 'DEN', direct_route_exists: false, origin: 'BGR' },
  'vl-airports-t3-nm-airports-smallest-outgoing-flights': {
    nm_airports_count: 51,
    smallest_origin_iata: '0E0',
    smallest_origin_name: 'Moriarty',
    smallest_outgoing_flights: 0,
    smallest_outgoing_routes: 0,
  },
  'vl-global-development-t1-lifeexp-max-2000': { country: 'Japan', life_expect: 81.57 },
  'vl-global-development-t2-fertility-1p5-2-2000': {
    count: 16,
    countries: [
      'Australia',
      'Barbados',
      'Belgium',
      'Chile',
      'China',
      'Cuba',
      'Finland',
      'France',
      'Georgia',
      'Ireland',
      'Netherlands',
      'New Zealand',
      'North Korea',
      'Norway',
      'Portugal',
      'United Kingdom',
    ],
  },
  'vl-global-development-t3-largest-lowest-lifeexp-2000': {
    min_life_country: 'Nigeria',
    min_life_expect: 54.63,
    topN: 10,
    top_countries_by_pop: [
      'China',
      'India',
      'United States',
      'Indonesia',
      'Brazil',
      'Pakistan',
      'Bangladesh',
      'Japan',
      'Nigeria',
      'Mexico',
    ],
  },
  'vl-seattle-weather-t1-sun-vs-rain-feb-apr-aug-oct': {
    counts: { 'Aug-Oct': { rain: 122, sun: 190 }, 'Feb-Apr': { rain: 209, sun: 115 } },
    more_rain: 'Feb-Apr',
    more_sun: 'Aug-Oct',
  },
  'vl-seattle-weather-t2-extreme-temp-by-weather': {
    rain: { max_date: '2014-08-11', max_temp_max: 35.6, min_date: '2014-02-09', min_temp_max: 3.9 },
    snow: { max_date: '2012-03-15', max_temp_max: 11.1, min_date: '2012-01-19', min_temp_max: -1.1 },
    sun: { max_date: '2015-07-19', max_temp_max: 35.0, min_date: '2014-02-06', min_temp_max: -1.6 },
  },
  'vl-seattle-weather-t3-snow-season-temp-range': {
    janApr: { max_temp_max: 11.1, min_temp_max: -1.1, n: 19 },
    novDec: { max_temp_max: 8.3, min_temp_max: 3.9, n: 7 },
    snow_counts_by_month: { 1: 8, 11: 1, 12: 6, 2: 4, 3: 6, 4: 1 },
    snow_months: [1, 2, 3, 4, 11, 12],
    temp_max_max: 11.1,
    temp_max_min: -1.1,
  },
};

const SETUPS: Setup[] = [
  {
    id: 'S1',
    title: 'Browser-only (no VACP)',
    query: { 'expose-bridge': '0' },
    needsSnapshot: false,
    needsStructuredResult: false,
  },
  {
    id: 'S2',
    title: 'DOM snapshot + browser primitives (no semantic actions)',
    query: { 'expose-bridge': '0', 'vacp-dom-snapshot': '1' },
    needsSnapshot: true,
    needsStructuredResult: false,
  },
  {
    id: 'S3',
    title: 'VACP semantic actions only (no browser interactions)',
    query: { 'expose-bridge': '1' },
    needsSnapshot: false,
    needsStructuredResult: true,
  },
  {
    id: 'S4',
    title: 'Full toolset (VACP + browser + screenshots + debug UI)',
    query: { 'expose-bridge': '1', 'vacp-dom-snapshot': '1', 'vacp-debug': '1' },
    needsSnapshot: false,
    needsStructuredResult: true,
  },
];

export async function runScenarioReportMatrix(args: {
  outDir?: string;
  date?: string;
  baseUrl?: string;
  directory?: string;
  concurrency?: number;
  model?: ModelSpec;
  autoApprove?: ArenaConfig['autoApprove'];
  timeoutMs?: number;
  force?: boolean;
}) {
  const repoRoot = await detectRepoRoot(process.cwd());
  const date = (args.date ?? new Date().toISOString().slice(0, 10)).trim();
  const baseUrl = (args.baseUrl ?? DEFAULT_BASE_URL).trim();
  const model = args.model ?? DEFAULT_MODEL;
  const outDir = resolveMatrixOutDir({ repoRoot, date, outDir: args.outDir });
  const arenaOutDir = path.join(outDir, '.agent-arena');
  const resume = !args.force;

  await assertHttpOk(baseUrl, 2500);

  await ensureSafeOutDir(outDir, Boolean(args.force));
  await fs.mkdir(arenaOutDir, { recursive: true });

  await writeMatrixRootFiles({ outDir, date, baseUrl });
  await ensureScenarioFolders({ outDir });

  const runs: ArenaJob[] = [];
  for (const setup of SETUPS) {
    for (const scenarioBase of SCENARIOS) {
      const url = buildScenarioUrl({
        baseUrl,
        route: scenarioBase.route,
        hash: scenarioBase.hash,
        query: setup.query,
      });
      runs.push({
        experiment: setup.id,
        model,
        scenario: { id: scenarioBase.id, url, task: scenarioBase.task },
        toolPolicy: { mode: 'allow', ids: ['functions.bash'] },
        promptTemplate: (ctx) =>
          buildPrompt({
            setup,
            scenario: scenarioBase,
            sessionID: ctx.opencode.sessionID ?? 'SESSION_ID_MISSING',
            url,
            artifactDir: path.join(path.relative(ctx.opencode.directory, outDir), scenarioBase.id),
            outputTemplate: setup.needsStructuredResult ? resultTemplateForScenarioId(scenarioBase.id) : null,
          }),
      });
    }
  }

  const config: ArenaConfig = {
    ...(args.directory ? { directory: resolveFromCwd(args.directory) } : {}),
    worktreeRoot: true,
    autoApprove: args.autoApprove ?? 'always',
    concurrency: { runs: args.concurrency ?? 2 },
    timeouts: { promptMs: args.timeoutMs ?? 20 * 60_000 },
    resume,
    runs,
  };

  const results = await runArena({
    config,
    outDir: arenaOutDir,
    hooks: {
      afterJob: async ({ job, result, directory, client, jobOutDir, uiBase }) => {
        if (!result.sessionID) return;
        const scenarioId = job.scenario.id ?? 'scenario';
        const setupId = job.experiment as Setup['id'];
        const scenarioDir = path.join(outDir, scenarioId);

        await fs.mkdir(scenarioDir, { recursive: true });

        await captureScreenshot({
          sessionID: result.sessionID,
          filePath: path.join(scenarioDir, `${setupId}.png`),
        });

        if (setupId === 'S2') {
          await captureDomSnapshot({
            sessionID: result.sessionID,
            filePath: path.join(scenarioDir, 'S2__vacp_snapshot.json'),
          });
        }

        const uiUrl = uiBase ? `${uiBase}/session/${result.sessionID}` : undefined;
        let exported: Awaited<ReturnType<typeof exportSessionLogs>> | null = null;
        try {
          exported = await exportSessionLogs({
            client,
            directory,
            sessionID: result.sessionID,
            outDir: jobOutDir,
            ...(uiUrl ? { uiUrl } : {}),
          });
        } catch (error) {
          consola.warn('Failed to export session logs', { sessionID: result.sessionID, error });
        }

        const assistantText = exported?.assistantFinal?.text ?? null;
        if (assistantText) {
          await writeTextFile(path.join(scenarioDir, `${setupId}_answer.txt`), assistantText);
        }

        if (setupId === 'S3' || setupId === 'S4') {
          if (!assistantText) {
            consola.warn('Missing assistant final text for structured result extraction', {
              sessionID: result.sessionID,
              scenarioId,
              setupId,
            });
          } else {
            try {
              const json = extractJsonFromText(assistantText);
              await writeJsonFile(path.join(scenarioDir, `${setupId}_result.json`), json);
            } catch (error) {
              consola.warn('Failed to parse structured JSON result from assistant final text', {
                sessionID: result.sessionID,
                scenarioId,
                setupId,
                error,
              });
            }
          }
        }

        const logDir = toPosixPath(path.relative(outDir, jobOutDir) || '.');
        const logDirFromScenario = toPosixPath(path.relative(scenarioDir, jobOutDir) || '.');
        const opencodeAudit = {
          experiment: String(job.experiment),
          scenarioId,
          setupId,
          ok: Boolean(result.ok),
          ...(result.projectID ? { projectID: result.projectID } : {}),
          sessionID: result.sessionID,
          ...(uiUrl ? { uiUrl } : {}),
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
          logDir,
          logDirFromScenario,
          logs: {
            inputJson: `${logDir}/input.json`,
            runJson: `${logDir}/run.json`,
            messagesJsonl: `${logDir}/messages.jsonl`,
            toolCallsJsonl: `${logDir}/tool_calls.jsonl`,
            metricsJson: `${logDir}/metrics.json`,
            sessionJson: `${logDir}/session.json`,
          },
          ...(exported?.metrics ? { metrics: exported.metrics } : {}),
        };
        await writeJsonFile(path.join(scenarioDir, `${setupId}_opencode.json`), opencodeAudit);
      },
    },
  });

  await writeReports({ outDir, date });
  await writeSummary({ outDir, date, results });
  const aggregated = await writeAggregatedMetrics({ arenaOutDir, outDir });
  await writeAuditGuide({ outDir, date, baseUrl, results, aggregated });
  await writeProvenance({
    repoRoot,
    outDir,
    date,
    baseUrl,
    model,
    concurrency: args.concurrency ?? 2,
    autoApprove: config.autoApprove ?? 'always',
    timeoutMs: config.timeouts?.promptMs ?? null,
    force: Boolean(args.force),
  });
  await writeManifest({ outDir });
  return results;
}

function buildScenarioUrl(args: { baseUrl: string; route: string; hash?: string; query: Record<string, string> }) {
  const u = new URL(args.route, args.baseUrl);
  for (const [k, v] of Object.entries(args.query)) u.searchParams.set(k, v);
  if (args.hash) u.hash = args.hash.startsWith('#') ? args.hash : `#${args.hash}`;
  return u.toString();
}

function buildPrompt(args: {
  setup: Setup;
  scenario: ScenarioBase;
  sessionID: string;
  url: string;
  artifactDir: string;
  outputTemplate: Record<string, unknown> | null;
}) {
  const agentBrowserCmd = `npx -y agent-browser@${AGENT_BROWSER_VERSION}`;
  const lines: string[] = [];

  lines.push(`# Scenario × Setup Matrix (${args.setup.id})`);
  lines.push(`Setup: ${args.setup.title}`);
  lines.push(`Scenario: ${args.scenario.id}`);
  lines.push(``);
  lines.push(`Task:`);
  lines.push(`> ${args.scenario.task}`);
  lines.push(``);
  lines.push(`URL: ${args.url}`);
  lines.push(`Artifacts directory (already exists): ${args.artifactDir}`);
  lines.push(``);

  if (args.setup.id === 'S1') {
    lines.push(`Constraints:`);
    lines.push(`- Use browser interaction primitives only (no VACP semantic actions; do not read DOM snapshot even if present).`);
    lines.push(``);
  }
  if (args.setup.id === 'S2') {
    lines.push(`Constraints:`);
    lines.push(`- Use browser interaction primitives.`);
    lines.push(`- You MAY read the DOM snapshot in <script id="__vacp_snapshot" type="application/json">{...}</script>,`);
    lines.push(`  but do NOT execute semantic actions (no window.__vacp bridge).`);
    lines.push(``);
  }
  if (args.setup.id === 'S3') {
    lines.push(`Constraints:`);
    lines.push(`- Use ONLY VACP semantic actions via the bridge (no click/hover/drag decisions).`);
    lines.push(`- Do NOT rely on screenshots for decision-making.`);
    lines.push(``);
  }
  if (args.setup.id === 'S4') {
    lines.push(`Constraints:`);
    lines.push(`- Full toolset is allowed (VACP semantic actions + browser primitives + screenshots).`);
    lines.push(``);
  }

  lines.push(`Use the agent-browser CLI (via bash) to open and control the app:`);
  lines.push(`- All commands MUST include \`--session ${args.sessionID}\``);
  lines.push(`- Open: \`${agentBrowserCmd} --session ${args.sessionID} open "${args.url}"\``);
  lines.push(`- Reference: \`${agentBrowserCmd} --help\``);
  lines.push(``);
  if (args.setup.id === 'S3' || args.setup.id === 'S4') {
    lines.push(`VACP bridge quickstart (run via \`agent-browser eval\`):`);
    lines.push(`- \`${agentBrowserCmd} --session ${args.sessionID} eval "(async () => await window.__vacp.getCapabilities())()"\``);
    lines.push(`- \`${agentBrowserCmd} --session ${args.sessionID} eval "(async () => await window.__vacp.getState())()"\``);
    lines.push(
      `- \`${agentBrowserCmd} --session ${args.sessionID} eval "(async () => await window.__vacp.execute({callId:'call', name:'<action-name>', params:{}}))()"\``,
    );
    lines.push(``);
  }

  lines.push(`At the end, a full-page screenshot will be captured automatically as \`${args.setup.id}.png\`.`);
  lines.push(`(You do not need to save screenshots yourself.)`);
  lines.push(`Do NOT run \`${agentBrowserCmd} --session ${args.sessionID} close\` (the harness captures evidence after you finish).`);

  if (args.setup.id === 'S2') {
    lines.push(`A DOM snapshot will be captured automatically as \`S2__vacp_snapshot.json\`.`);
  }

  if (args.outputTemplate) {
    lines.push(``);
    lines.push(`Final answer format (return ONLY valid JSON, no markdown):`);
    lines.push(JSON.stringify(args.outputTemplate, null, 2));
    lines.push(``);
    lines.push(`Rules:`);
    lines.push(`- Output must be JSON only (no surrounding text).`);
    lines.push(`- Use numbers (not numeric strings) where appropriate.`);
    lines.push(`- Sort arrays deterministically when the task implies a set (e.g. country lists).`);
  }

  return lines.join('\n');
}

function resultTemplateForScenarioId(scenarioId: string): Record<string, unknown> {
  const expected = ANSWERS_EXPECTED[scenarioId];
  if (!expected) return {};
  return templateFromExample(expected);
}

function templateFromExample(value: unknown): Record<string, unknown> {
  const t = templateValue(value);
  if (t && typeof t === 'object' && !Array.isArray(t)) return t as Record<string, unknown>;
  return { result: t };
}

function templateValue(value: unknown): unknown {
  if (value === null) return null;
  const typ = typeof value;
  if (typ === 'number') return '<number>';
  if (typ === 'string') return '<string>';
  if (typ === 'boolean') return '<boolean>';
  if (Array.isArray(value)) {
    const first = value.length > 0 ? templateValue(value[0]) : '<any>';
    return [first];
  }
  if (typ === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, templateValue(v)]));
  }
  return '<any>';
}

async function writeMatrixRootFiles(args: { outDir: string; date: string; baseUrl: string }) {
  await writeTextFile(
    path.join(args.outDir, 'README.md'),
    [
      `# Scenario × Setup Matrix (OpenCode run)`,
      ``,
      `Run date: ${args.date}`,
      ``,
      `## Setup URLs`,
      ``,
      `- **S1** (Browser-only, no VACP): \`?expose-bridge=0\``,
      `- **S2** (DOM snapshot + browser primitives): \`?expose-bridge=0&vacp-dom-snapshot=1\``,
      `- **S3** (VACP actions only): \`?expose-bridge=1\``,
      `- **S4** (Full toolset): \`?expose-bridge=1&vacp-dom-snapshot=1&vacp-debug=1\``,
      ``,
      `Base URL: ${args.baseUrl}`,
      ``,
      `## Evidence Layout`,
      ``,
      `For each scenario ID, see:`,
      ``,
      `- \`./answers_expected.json\``,
      `- \`./<scenario-id>/report.md\``,
      `- \`./<scenario-id>/S1.png\`, \`S1_answer.txt\`, \`S1_opencode.json\``,
      `- \`./<scenario-id>/S2.png\`, \`S2_answer.txt\`, \`S2_opencode.json\`, \`S2__vacp_snapshot.json\``,
      `- \`./<scenario-id>/S3.png\`, \`S3_answer.txt\`, \`S3_opencode.json\`, \`S3_result.json\``,
      `- \`./<scenario-id>/S4.png\`, \`S4_answer.txt\`, \`S4_opencode.json\`, \`S4_result.json\``,
      ``,
      `Root-level audit and metrics:`,
      `- \`./audit.md\``,
      `- \`./metrics.csv\`, \`./metrics.jsonl\`, \`./tool_calls.jsonl\``,
      `- \`./provenance.json\`, \`./manifest.json\``,
      ``,
      `## OpenCode metadata`,
      ``,
      `Detailed OpenCode session logs and per-run bookkeeping are under:`,
      `- \`./.agent-arena/\``,
      ``,
    ].join('\n'),
  );

  await writeJsonFile(path.join(args.outDir, 'answers_expected.json'), ANSWERS_EXPECTED);

  await writeTextFile(
    path.join(args.outDir, 'slack.md'),
    [
      `Hi there!`,
      ``,
      `Quick update on the Scenario × Setup Matrix run (${args.date}).`,
      ``,
      `Evidence folder: \`nogit/scenario-report-matrix/${args.date}/\``,
      ``,
      `This run evaluates the same 15 scenarios under four setups:`,
      `- S1: browser-only (no VACP)`,
      `- S2: DOM snapshot + browser primitives (no semantic actions)`,
      `- S3: VACP semantic actions only`,
      `- S4: full toolset`,
      ``,
      `Per-scenario evidence includes screenshots and (for S3/S4) structured result JSON.`,
      ``,
    ].join('\n'),
  );
}

async function ensureScenarioFolders(args: { outDir: string }) {
  await Promise.all(
    SCENARIOS.map(async (s) => {
      await fs.mkdir(path.join(args.outDir, s.id), { recursive: true });
    }),
  );
}

async function writeReports(args: { outDir: string; date: string }) {
  for (const scenario of SCENARIOS) {
    const scenarioDir = path.join(args.outDir, scenario.id);
    const expected = ANSWERS_EXPECTED[scenario.id];

    const s3Path = path.join(scenarioDir, 'S3_result.json');
    const s4Path = path.join(scenarioDir, 'S4_result.json');
    const s3 = await readJsonIfExists(s3Path);
    const s4 = await readJsonIfExists(s4Path);

    const s3Ok = expected ? deepEqualNormalized(s3, expected) : null;
    const s4Ok = expected ? deepEqualNormalized(s4, expected) : null;
    const s3eqs4 = s3 && s4 ? deepEqualNormalized(s3, s4) : null;

    const md: string[] = [];
    md.push(`# Scenario: \`${scenario.id}\``);
    md.push(``);
    md.push(`Run date: ${args.date}`);
    md.push(``);
    md.push(`**Task**: ${scenario.task}`);
    md.push(``);
    md.push(`## Evidence`);
    md.push(`- S1: \`S1.png\`, \`S1_answer.txt\`, \`S1_opencode.json\``);
    md.push(`- S2: \`S2.png\`, \`S2_answer.txt\`, \`S2_opencode.json\`, \`S2__vacp_snapshot.json\``);
    md.push(`- S3: \`S3.png\`, \`S3_answer.txt\`, \`S3_opencode.json\`, \`S3_result.json\``);
    md.push(`- S4: \`S4.png\`, \`S4_answer.txt\`, \`S4_opencode.json\`, \`S4_result.json\``);
    md.push(``);
    if (expected) {
      md.push(`## Expected (from data files)`);
      md.push('```json');
      md.push(JSON.stringify(expected, null, 2));
      md.push('```');
      md.push(``);
    }
    if (s3) {
      md.push(`## Actual`);
      md.push(`### S3`);
      md.push('```json');
      md.push(JSON.stringify(s3, null, 2));
      md.push('```');
      md.push(``);
    }
    if (s4) {
      if (!s3) md.push(`## Actual`);
      md.push(`### S4`);
      md.push('```json');
      md.push(JSON.stringify(s4, null, 2));
      md.push('```');
      md.push(``);
    }

    md.push(`## Checks`);
    md.push(`- S3 matches expected: ${s3Ok === null ? 'N/A' : s3Ok ? 'YES' : 'NO'}`);
    md.push(`- S4 matches expected: ${s4Ok === null ? 'N/A' : s4Ok ? 'YES' : 'NO'}`);
    md.push(`- S3 == S4: ${s3eqs4 === null ? 'N/A' : s3eqs4 ? 'YES' : 'NO'}`);
    md.push(``);

    await writeTextFile(path.join(scenarioDir, 'report.md'), md.join('\n'));
  }
}

async function writeSummary(args: { outDir: string; date: string; results: ArenaRunResult[] }) {
  const s3 = args.results.filter((r) => r.experiment === 'S3' && r.ok);
  const s4 = args.results.filter((r) => r.experiment === 'S4' && r.ok);

  const rows = SCENARIOS.map((scenario) => {
    const expected = ANSWERS_EXPECTED[scenario.id];
    const s3Path = path.join(args.outDir, scenario.id, 'S3_result.json');
    const s4Path = path.join(args.outDir, scenario.id, 'S4_result.json');
    return { scenario, expected, s3Path, s4Path };
  });

  let s3Matches = 0;
  let s4Matches = 0;
  let s3eqs4 = 0;
  let comparable = 0;

  for (const row of rows) {
    const expected = row.expected;
    const s3Json = await readJsonIfExists(row.s3Path);
    const s4Json = await readJsonIfExists(row.s4Path);
    if (!expected || !s3Json || !s4Json) continue;
    comparable += 1;
    if (deepEqualNormalized(s3Json, expected)) s3Matches += 1;
    if (deepEqualNormalized(s4Json, expected)) s4Matches += 1;
    if (deepEqualNormalized(s3Json, s4Json)) s3eqs4 += 1;
  }

  const lines: string[] = [];
  lines.push(`# Scenario × Setup Matrix — Summary (${args.date})`);
  lines.push(``);
  lines.push(`This file is generated by \`agent-arena matrix\` to mirror the manual evidence layout.`);
  lines.push(``);
  lines.push(`## Run stats`);
  lines.push(`- Total runs: ${args.results.length}`);
  lines.push(`- S3 ok: ${s3.length}/${SCENARIOS.length}`);
  lines.push(`- S4 ok: ${s4.length}/${SCENARIOS.length}`);
  lines.push(``);
  lines.push(`## Answer checks (S3/S4 only)`);
  lines.push(`- Comparable scenarios: ${comparable}/${SCENARIOS.length}`);
  lines.push(`- S3 matches expected: ${s3Matches}/${comparable || 1}`);
  lines.push(`- S4 matches expected: ${s4Matches}/${comparable || 1}`);
  lines.push(`- S3 == S4: ${s3eqs4}/${comparable || 1}`);
  lines.push(``);
  lines.push(`## Per-scenario`);
  lines.push(``);
  lines.push(`| Scenario | S3==expected | S4==expected | S3==S4 |`);
  lines.push(`|---|---:|---:|---:|`);

  for (const scenario of SCENARIOS) {
    const expected = ANSWERS_EXPECTED[scenario.id];
    const s3Json = await readJsonIfExists(path.join(args.outDir, scenario.id, 'S3_result.json'));
    const s4Json = await readJsonIfExists(path.join(args.outDir, scenario.id, 'S4_result.json'));
    const okS3 = expected && s3Json ? (deepEqualNormalized(s3Json, expected) ? '✅' : '❌') : '—';
    const okS4 = expected && s4Json ? (deepEqualNormalized(s4Json, expected) ? '✅' : '❌') : '—';
    const eq = s3Json && s4Json ? (deepEqualNormalized(s3Json, s4Json) ? '✅' : '❌') : '—';
    lines.push(`| \`${scenario.id}\` | ${okS3} | ${okS4} | ${eq} |`);
  }

  lines.push(``);
  lines.push(`See each \`./<scenario-id>/report.md\` for details.`);
  lines.push(``);

  await writeTextFile(path.join(args.outDir, 'summary.md'), lines.join('\n'));
}

async function ensureSafeOutDir(outDir: string, force: boolean) {
  await fs.mkdir(outDir, { recursive: true });
  const entries = await fs.readdir(outDir);
  if (entries.length === 0) return;

  if (force) return;

  // If this looks like an existing agent-arena matrix run (has internal folder), treat it as resumable.
  if (entries.includes('.agent-arena')) return;

  throw new Error(
    [
      `Refusing to write into a non-empty directory without ".agent-arena":`,
      `- ${outDir}`,
      ``,
      `Pick a different --out directory, or pass --force to overwrite/reuse this folder.`,
    ].join('\n'),
  );
}

async function assertHttpOk(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal }).catch((error) => {
      throw new Error(`Failed to reach ${url}: ${String(error)}`);
    });
    if (!res.ok) throw new Error(`Non-OK HTTP status from ${url}: ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}

async function captureScreenshot(args: { sessionID: string; filePath: string }) {
  await fs.mkdir(path.dirname(args.filePath), { recursive: true });
  try {
    await execAgentBrowser([
      '--session',
      args.sessionID,
      'screenshot',
      '--full',
      resolveFromCwd(args.filePath),
    ]);
  } catch (error) {
    consola.warn('Failed to capture screenshot', { sessionID: args.sessionID, filePath: args.filePath, error });
  }
}

async function captureDomSnapshot(args: { sessionID: string; filePath: string }) {
  try {
    const { stdout } = await execAgentBrowserWithOutput([
      '--session',
      args.sessionID,
      'get',
      'text',
      '#__vacp_snapshot',
    ]);
    const text = stdout.trim();
    if (!text) throw new Error('Empty snapshot text');
    const parsed = JSON.parse(text) as unknown;
    await writeJsonFile(args.filePath, parsed);
  } catch (error) {
    consola.warn('Failed to capture DOM snapshot', { sessionID: args.sessionID, filePath: args.filePath, error });
  }
}

function extractJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Empty text');

  const fence = trimmed.match(/```json\\s*([\\s\\S]*?)\\s*```/i);
  if (fence?.[1]) return JSON.parse(fence[1].trim());

  try {
    return JSON.parse(trimmed);
  } catch {}

  const firstObj = trimmed.indexOf('{');
  const lastObj = trimmed.lastIndexOf('}');
  if (firstObj >= 0 && lastObj > firstObj) {
    const slice = trimmed.slice(firstObj, lastObj + 1);
    return JSON.parse(slice);
  }

  const firstArr = trimmed.indexOf('[');
  const lastArr = trimmed.lastIndexOf(']');
  if (firstArr >= 0 && lastArr > firstArr) {
    const slice = trimmed.slice(firstArr, lastArr + 1);
    return JSON.parse(slice);
  }

  throw new Error('No JSON object/array found in assistant text');
}

async function execAgentBrowser(args: string[]) {
  await execFileAsync('npx', ['-y', `agent-browser@${AGENT_BROWSER_VERSION}`, ...args], { encoding: 'utf8' });
}

async function execAgentBrowserWithOutput(args: string[]) {
  return await execFileAsync('npx', ['-y', `agent-browser@${AGENT_BROWSER_VERSION}`, ...args], {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
}

async function writeJsonFile(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

async function writeTextFile(filePath: string, contents: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents.endsWith('\n') ? contents : contents + '\n', 'utf8');
}

async function readJsonIfExists(filePath: string) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function deepEqualNormalized(a: unknown, b: unknown): boolean {
  if (a === null || b === null) return a === b;
  const na = normalizeJson(a);
  const nb = normalizeJson(b);
  return JSON.stringify(na) === JSON.stringify(nb);
}

function normalizeJson(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = normalizeJson(obj[key]);
    }
    return out;
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (/^-?\\d+(?:\\.\\d+)?$/.test(s)) {
      const num = Number(s);
      if (Number.isFinite(num)) return num;
    }
    return value;
  }
  return value;
}

function toPosixPath(p: string) {
  return p.split(path.sep).join('/');
}

async function detectRepoRoot(startDir: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: startDir, encoding: 'utf8' });
    const gitRoot = stdout.trim();
    if (gitRoot) return gitRoot;
  } catch {}

  let dir = startDir;
  for (let i = 0; i < 30; i += 1) {
    if (await pathExists(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    if (await pathExists(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return startDir;
}

function resolveMatrixOutDir(args: { repoRoot: string; date: string; outDir?: string }): string {
  const rawOut = typeof args.outDir === 'string' ? args.outDir.trim() : '';
  const out = rawOut.length > 0 ? rawOut : path.join('nogit', 'scenario-report-matrix', args.date);
  return path.isAbsolute(out) ? out : path.resolve(args.repoRoot, out);
}

async function pathExists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function writeAuditGuide(args: {
  outDir: string;
  date: string;
  baseUrl: string;
  results: ArenaRunResult[];
  aggregated: Awaited<ReturnType<typeof writeAggregatedMetrics>>;
}) {
  const rows = args.aggregated.rows.map((r) => ({ ...r, logDir: toPosixPath(r.logDir) }));

  const ok = args.results.filter((r) => r.ok).length;
  const bad = args.results.length - ok;

  const lines: string[] = [];
  lines.push(`# Audit guide — Scenario × Setup Matrix (${args.date})`);
  lines.push(``);
  lines.push(`This folder is intended to be paper-supplement ready and auditable end-to-end.`);
  lines.push(``);
  lines.push(`## Run overview`);
  lines.push(`- Total runs: ${args.results.length} (${ok} ok, ${bad} failed)`);
  lines.push(`- Base URL: ${args.baseUrl}`);
  lines.push(``);
  lines.push(`## What to cite / archive`);
  lines.push(`- Evidence: \`./<scenario-id>/\` (screenshots, DOM snapshot, answers/results, run pointers)`);
  lines.push(`- OpenCode logs + bookkeeping: \`./.agent-arena/\``);
  lines.push(`- Aggregated metrics: \`./metrics.csv\`, \`./metrics.jsonl\`, \`./tool_calls.jsonl\``);
  lines.push(`- Reproducibility + integrity: \`./provenance.json\`, \`./manifest.json\``);
  lines.push(``);
  lines.push(`## How to audit a single run`);
  lines.push(`1. Open \`./<scenario-id>/report.md\` for the task and evidence list.`);
  lines.push(`2. Open \`./<scenario-id>/S*_opencode.json\` to get the OpenCode session ID and log paths.`);
  lines.push(`3. Inspect \`./.agent-arena/runs/<...>/messages.jsonl\` and \`tool_calls.jsonl\` (full audit trail).`);
  lines.push(`4. Use \`./.agent-arena/runs/<...>/metrics.json\` for tokens/cost/time/tool-call totals.`);
  lines.push(``);
  lines.push(`## Runs table (from aggregated metrics)`);
  lines.push(``);
  lines.push(`| Setup | Scenario | ok | cost | tokens (in/out) | duration_ms | tool_calls | session_id | log_dir |`);
  lines.push(`|---|---|---:|---:|---:|---:|---:|---|---|`);
  for (const r of rows) {
    const tokens = typeof r.tokensInput === 'number' || typeof r.tokensOutput === 'number' ? `${r.tokensInput ?? 0}/${r.tokensOutput ?? 0}` : '';
    lines.push(
      `| \`${r.experiment}\` | \`${r.scenarioId}\` | ${r.ok ? '✅' : '❌'} | ${fmtNum(r.cost)} | ${tokens ? `\`${tokens}\`` : ''} | ${fmtNum(r.durationMs)} | ${fmtNum(r.toolCalls)} | \`${r.sessionID ?? ''}\` | \`${r.logDir}\` |`,
    );
  }
  lines.push(``);

  await writeTextFile(path.join(args.outDir, 'audit.md'), lines.join('\n'));
}

function fmtNum(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

async function writeProvenance(args: {
  repoRoot: string;
  outDir: string;
  date: string;
  baseUrl: string;
  model: ModelSpec;
  concurrency: number;
  autoApprove: ArenaConfig['autoApprove'];
  timeoutMs: number | null;
  force: boolean;
}) {
  const gitCommit = await execCmdTrim('git', ['rev-parse', 'HEAD'], { cwd: args.repoRoot }).catch(() => null);
  const gitBranch = await execCmdTrim('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: args.repoRoot }).catch(() => null);
  const gitDirtyRaw = await execCmdTrim('git', ['status', '--porcelain'], { cwd: args.repoRoot }).catch(() => null);
  const gitStatus = typeof gitDirtyRaw === 'string' ? (gitDirtyRaw.trim().length > 0 ? 'dirty' : 'clean') : null;

  const pnpmVersion = await execCmdTrim('pnpm', ['--version']).catch(() => null);
  const opencodeVersion = await execCmdTrim('opencode', ['--version']).catch(() => null);

  const agentArenaPkg = await readJsonOrNull(path.join(args.repoRoot, 'packages', 'agent-arena', 'package.json'));
  const agentArenaVersion = typeof agentArenaPkg?.version === 'string' ? agentArenaPkg.version : null;
  const opencodeSdkVersion =
    typeof agentArenaPkg?.dependencies?.['@opencode-ai/sdk'] === 'string'
      ? String(agentArenaPkg.dependencies['@opencode-ai/sdk'])
      : null;

  const provenance = {
    generatedAt: new Date().toISOString(),
    generator: {
      name: '@vacp/agent-arena',
      ...(agentArenaVersion ? { version: agentArenaVersion } : {}),
      ...(opencodeSdkVersion ? { opencodeSdk: opencodeSdkVersion } : {}),
    },
    git: {
      ...(gitCommit ? { commit: gitCommit } : {}),
      ...(gitBranch ? { branch: gitBranch } : {}),
      ...(gitStatus ? { status: gitStatus } : {}),
    },
    environment: {
      node: process.version,
      ...(pnpmVersion ? { pnpm: pnpmVersion } : {}),
      ...(opencodeVersion ? { opencode: opencodeVersion } : {}),
      platform: process.platform,
      arch: process.arch,
    },
    matrix: {
      date: args.date,
      baseUrl: args.baseUrl,
      model: args.model,
      concurrency: args.concurrency,
      autoApprove: args.autoApprove ?? null,
      timeoutMs: args.timeoutMs,
      agentBrowser: `agent-browser@${AGENT_BROWSER_VERSION}`,
      force: args.force,
    },
  };

  await writeJsonFile(path.join(args.outDir, 'provenance.json'), provenance);
}

async function writeManifest(args: { outDir: string }) {
  const files = await listFilesRecursive(args.outDir);
  const entries: Array<{ path: string; size: number; sha256: string }> = [];
  for (const filePath of files) {
    const rel = path.relative(args.outDir, filePath);
    const relPosix = toPosixPath(rel);
    if (relPosix === 'manifest.json') continue;
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) continue;
    const sha256 = await sha256File(filePath);
    entries.push({ path: relPosix, size: stat.size, sha256 });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  await writeJsonFile(path.join(args.outDir, 'manifest.json'), {
    generatedAt: new Date().toISOString(),
    algorithm: 'sha256',
    files: entries,
  });
}

async function listFilesRecursive(root: string) {
  const out: string[] = [];
  await walk(root, async (full, ent) => {
    if (ent.isFile()) out.push(full);
  });
  return out;
}

async function walk(
  root: string,
  onEntry: (fullPath: string, ent: { name: string; isFile(): boolean; isDirectory(): boolean }) => Promise<void>,
) {
  let entries: Array<{ name: string; isFile(): boolean; isDirectory(): boolean }> = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(root, ent.name);
    await onEntry(full, ent);
    if (ent.isDirectory()) await walk(full, onEntry);
  }
}

async function sha256File(filePath: string) {
  return await new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function execCmdTrim(cmd: string, args: string[], options?: { cwd?: string }) {
  const { stdout } = await execFileAsync(cmd, args, { cwd: options?.cwd, encoding: 'utf8' });
  return stdout.trim();
}

async function readJsonOrNull(filePath: string) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as any;
  } catch {
    return null;
  }
}
