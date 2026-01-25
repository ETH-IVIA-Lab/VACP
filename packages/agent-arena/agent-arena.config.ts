import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { ArenaConfig, ArenaJob, PromptContext } from './src/types';
import { mcpToolId } from './src/opencode-ids';

const BASE_URL = 'http://127.0.0.1:5173';

const MODELS = [
  { providerID: 'openai', modelID: 'gpt-5.2' },
];

export const SCENARIO_BASES = [
  {
    id: 'vl-global-development-t1-lifeexp-max-2000',
    route: '/vega-lite/',
    hash: 'global-development',
    task: 'Which country had the highest life expectancy in 2000?',
    responseFormat: '{country: string, lifeExpectancy: number}',
    solution: { country: 'Japan', lifeExpectancy: 81.6 },
  },
  {
    id: 'vl-global-development-t2-fertility-1p5-2-2000',
    route: '/vega-lite/',
    hash: 'global-development',
    task: 'Which countries in year 2000 have the fertility (children per woman) between 1.5-2?',
    responseFormat: '{countries: Array<string>}',
    solution: {
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
  },
  {
    id: 'vl-global-development-t3-largest-lowest-lifeexp-2000',
    route: '/vega-lite/',
    hash: 'global-development',
    task: 'Which of the largest countries in the world had the lowest life expectancy in 2000?',
    responseFormat: '{country: string, lifeExpectancy: number}',
    solution: { country: 'Nigeria', lifeExpectancy: 54.6 },
  },
  {
    id: 'vl-seattle-weather-t1-sun-vs-rain-feb-apr-aug-oct',
    route: '/vega-lite/',
    hash: 'seattle-weather',
    task: 'Please compare the amount of rainy and sunny days in the range of Februry-April and August-October. Which range has more sunny days, which has more rainy days?',
    responseFormat: '{moreSunnyRange: string, moreRainyRange: string}',
    solution: { moreSunnyRange: 'August-October', moreRainyRange: 'February-April' },
  },
  {
    id: 'vl-seattle-weather-t2-extreme-temp-by-weather',
    route: '/vega-lite/',
    hash: 'seattle-weather',
    task: 'Determine the extreme temp_max values associated with rain, sun, snow.',
    responseFormat: '{rainTempMax: number, sunTempMax: number, snowTempMax: number}',
    solution: { rainTempMax: 35.6, sunTempMax: 35, snowTempMax: 11.1 },
  },
  {
    id: 'vl-seattle-weather-t3-snow-season-temp-range',
    route: '/vega-lite/',
    hash: 'seattle-weather',
    task: 'Examine when snow occurs in the year and the corresponding temperature ranges.',
    responseFormat: '{observations: Array<{month: string, tempMin: number, tempMax: number}>}',
    solution: {
      observations: [
        { month: 'January', tempMin: -1.1, tempMax: 7.2 },
        { month: 'February', tempMin: 5, tempMax: 6.7 },
        { month: 'March', tempMin: 5.6, tempMax: 11.1 },
        { month: 'April', tempMin: 9.4, tempMax: 9.4 },
        { month: 'November', tempMin: 4.4, tempMax: 4.4 },
        { month: 'December', tempMin: 3.9, tempMax: 8.3 },
      ],
    },
  },
  {
    id: 'mosaic-athletes-t1-regression-football-vs-cycling',
    route: '/mosaic/',
    hash: 'athletes',
    task: 'Compare the male athletes of football and cycling. For which sport is the regression line steeper?',
    responseFormat: '{steeperSport: string}',
    solution: { steeperSport: 'football' },
  },
  {
    id: 'mosaic-athletes-t2-top3-tallest-female',
    route: '/mosaic/',
    hash: 'athletes',
    task: 'Name three tallest female athletes and their height.',
    responseFormat: '{tallestFemales: Array<{name: string, height: number}>}',
    solution: {
      tallestFemales: [
        { name: 'Brittney Griner', height: 2.03 },
        { name: 'Elizabeth Cambage', height: 2.03 },
        { name: 'Linet Arasa', height: 2.03 },
      ],
    },
  },
  {
    id: 'mosaic-athletes-t3-female-judo-100-120kg-count',
    route: '/mosaic/',
    hash: 'athletes',
    task: 'How many female judo practitioners are between 100 and 120 kg?',
    responseFormat: '{count: number}',
    solution: { count: 3 },
  },
  {
    id: 'vl-airports-t1-nd-most-outgoing-top-destination',
    route: '/vega-lite/',
    hash: 'airports',
    task: 'Find in state ND (North Dakota) the airport with the most outgoing flight connections. Which airport are the most flights to?',
    responseFormat: '{airport: string, topDestination: string}',
    solution: { airport: 'FAR', topDestination: 'MSP' },
  },
  {
    id: 'vl-airports-t2-bangor-to-denver',
    route: '/vega-lite/',
    hash: 'airports',
    task: 'Is it possible to fly from airport Bangor International (State ME, Maine) to airport Denver Intl (CO, Colorado) without transfer?',
    responseFormat: '{isPossible: boolean}',
    solution: { isPossible: false },
  },
  {
    id: 'vl-airports-t3-nm-airports-smallest-outgoing-flights',
    route: '/vega-lite/',
    hash: 'airports',
    task: 'How many airports are there in state New Mexico (NM)? How many outgoing flights does the smalles airport of these have?',
    responseFormat: '{count: number, smallestOutgoingFlights: number}',
    solution: { count: 2, smallestOutgoingFlights: 961 },
  },
  {
    id: 'cars-parcoords-t1-cylinders-4-weight-range',
    route: '/cars-parcoords/',
    task: 'Select cylinders 4, what is the range of the weight of the cars',
    responseFormat: '{minWeight: number, maxWeight: number}',
    solution: { minWeight: 1613, maxWeight: 3270 },
  },
  {
    id: 'cars-parcoords-t2-largest-positive-correlation',
    route: '/cars-parcoords/',
    task: 'Which dimensions do have the largest positive correlation',
    responseFormat: '{dimensions: [string, string]}',
    solution: { dimensions: ['Displacement', 'Weight'] },
  },
  {
    id: 'cars-parcoords-t3-cylinders-6-horsepower-outliers',
    route: '/cars-parcoords/',
    task: 'Given the cars with 6 zylinders identify outliers with respect to the horse power dimension',
    responseFormat: '{outliers: Array<{name: string, horsepower: number}>}',
    solution: {
      outliers: [
        { name: 'Ford Maverick', horsepower: 0 },
        { name: 'Buick Regal Sport Coupe (turbo)', horsepower: 165 },
      ],
    },
  },
];

const DEFAULT_MCP_TIMEOUT_MS = 120_000;
const AGENT_BROWSER = 'agent-browser';
const CHART_READY_SELECTOR = '#app canvas, #app svg, #chart canvas, #chart svg';
const CHART_READY_SCREENSHOT_NAME = 'step-00.png';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function agentBrowserEfficiencyGuidance(ctx: PromptContext): string[] {
  return [
    'Efficiency (high priority; avoid timeouts + token bloat):',
    '- Do NOT run `agent-browser --help` (it is huge and wastes time/tokens).',
    '- Prefer at most 1 `agent-browser snapshot -i -c --depth 10` per page state; only re-run snapshot after a real UI state change (snapshots can be huge).',
    '- Prefer `click @ref` / `hover @ref` using refs from `snapshot` over CSS selectors, `find`, or `get html`.',
    '- Avoid `agent-browser get html` / large `get text` dumps; they balloon the transcript and slow the run.',
    '- Avoid repeated `mouse` probing / boundingBox loops; do 1 deliberate hover/click, then screenshot + read.',
    '- If the UI already provides a table/list of records, prefer using it (filter/sort/scroll/count) over fragile brush/drag gestures to answer count/range questions.',
    '- Attempt caps (to prevent thrash/timeouts): if an interaction fails (tool error or no visible change), try at most 1 alternative (2 attempts total) then switch strategy. If still blocked, stop early and follow “If you cannot solve” instead of looping until timeout.',
    '- Hard budget (avoid timeouts): aim for ≤ 30 `bash` calls and ≤ 8 screenshots READ. If you reach 35 `bash` calls or 10 READ screenshots without a clear path to the answer, stop and output `null` (do not run until the prompt timeout).',
    'Agent-browser primitives (to avoid wasted attempts):',
    '- `drag` expects selectors/refs, not coordinates (e.g. `drag @from @to`).',
    '- For coordinate-based dragging/brushing, use `mouse`: `mouse move X Y` → `mouse down` → `mouse move X Y` → `mouse up`.',
    '- For scrolling, use `mouse wheel 0 800` (after moving over the region you want to scroll).',
    '- Use `eval` only when necessary to apply a UI change that is hard to do via clicks; never dump large JSON/DOM.',
    '- Shell-safe `eval` rules (zsh-safe; critical): always pass eval code in SINGLE quotes, like `agent-browser ... eval \'() => { ... }\'`. Inside the JS, prefer DOUBLE quotes for strings. Never use JS template literals/backticks (`` `...` ``) or `${...}`. Avoid unescaped `$`, backticks, or `$(...)` in the eval text (the shell will expand them and break the command).',
    '- If an `eval` command fails with a shell parse error (e.g. `bad substitution`, `no matches found`, `parse error`), rewrite it to obey the shell-safe rules above and retry at most once.',
    '- Only take step-XX screenshots after a successful state change (don’t screenshot after failed attempts).',
    `- Always use screenshot paths exactly as written (copy/paste): "${ctx.run.outDir}/step-00.png", "${ctx.run.outDir}/step-01.png", ... (don’t rewrite directory segments).`,
    '- Do NOT manually close the browser session; cleanup is handled automatically.',
  ];
}

function snapshotDomEfficiencyGuidance(): string[] {
  return [
    'Snapshot note (useful but easy to misuse):',
    '- You MAY use `agent-browser eval` to read small bits of `#__vacp_snapshot` to find control IDs/allowed values or to dispatch a specific UI change.',
    '- When using `eval` with the snapshot, follow the shell-safe `eval` rules above (single quotes, no backticks/`${...}`, keep outputs tiny).',
    '- Do NOT dump the whole snapshot JSON; extract only the minimum needed fields and keep outputs tiny.',
    '- Still ground the final answer in screenshots you READ (visual evidence), not just the snapshot.',
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
            'Hard constraints (must follow):',
            '- Treat the repository, local filesystem, and run artifacts as off-limits.',
            `- Do NOT use the \`read\` tool on anything except screenshots you create for this run: "${ctx.run.outDir}/step-00.png", "${ctx.run.outDir}/step-01.png", ...`,
            '- Run all `agent-browser ...` commands via the `bash` tool (do not just paste commands as text).',
            '- Do NOT use the `bash` tool for anything except `agent-browser ...` commands (no `ls`, `cat`, `rg`, scripting, etc).',
            '- Do NOT try to solve by inspecting source files, configs, logs, or `.agent-arena/**` outputs.',
            '',
            'Rules:',
            '- Do not start solving until a chart is visibly rendered (not a blank/loading screen).',
            '- Do NOT reload/refresh/re-open the page while waiting for the initial chart render.',
            '- Ground your answer ONLY in evidence you obtain through genuine interaction with the app in this run (screenshots + visible UI changes). Do NOT use memorized/prior knowledge of the dataset/chart to answer.',
            `- Chart-ready sentinel: write "${ctx.run.outDir}/${CHART_READY_SCREENSHOT_NAME}" and READ it; only proceed once the chart is clearly visible.`,
            `- Visual grounding: after each meaningful interaction, write and READ "${ctx.run.outDir}/step-01.png", "step-02.png", ... (two digits). Use the screenshots to decide next actions.`,
            '',
            ...agentBrowserEfficiencyGuidance(ctx),
            '',
            'Start:',
            `- (bash) Open: \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} open '${ctx.scenario.url}'\``,
            `- (bash) Wait (minimum 5s): \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} wait 5000\``,
            `- (bash) Wait for chart render: \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} wait "${CHART_READY_SELECTOR}"\``,
            `- (bash) Screenshot (chart-ready sentinel): \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} screenshot --full "${ctx.run.outDir}/${CHART_READY_SCREENSHOT_NAME}"\``,
            `- Verify (read screenshot): use the \`read\` tool on "${ctx.run.outDir}/${CHART_READY_SCREENSHOT_NAME}". If the chart is not visible yet, wait 5s and overwrite step-00.png again (no reload) until it is.`,
            `- (bash) Screenshot (after each interaction): \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} screenshot --full "${ctx.run.outDir}/step-01.png"\` (then step-02.png, step-03.png, ...)`,
            '',
            'Final answer (must follow, exact formatting):',
            `- Answer: on its own line, then output formatted JSON on the following lines inside \`\`\`json fences\`\`\` (start with \`\`\`json and end with \`\`\`), matching \`${ctx.scenario.responseFormat}\`.`,
            '- Reasoning: 1-3 sentences (brief) on its own line after the Answer JSON fence (do not include reasoning inside the JSON).',
            '- Reflection: 2-5 sentences (brief) on its own line. MUST include: (1) `Provenance: interaction-derived` OR `Provenance: prior-knowledge/guess`, (2) confidence (low/medium/high), (3) what was difficult/easy and why + whether your process felt robust or brittle, and (4) the main actions/options you had at your disposal in this run (tools/capabilities/UI interactions) and why you chose the ones you used over the alternatives. If any prior knowledge influenced you, say so explicitly and what you did/did not verify via interaction.',
            '- Screenshot log: after the Reflection, output a bulleted list (one bullet per screenshot you READ), in order, starting with `- step-00.png:`. Each bullet MUST be in the form `- step-01.png: <what you did/tried> | <why> | <what you observed> | <how it moved you closer to the answer>`. Be specific. Include this even if you cannot solve.',
            '- Trajectory: 3-6 sentences (high-level) summarizing your overall approach across the run: what you expected initially, what you tried, what worked/failed, any pivots, and how you decided on the final Answer. Reference key screenshots (e.g. step-03.png) where relevant. Keep it honest; do not invent evidence.',
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
        experiment: 'with-snapshot',
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
            'Use the `bash` tool to run the `agent-browser` CLI (this is your browser access) and answer the task.',
            '',
            'Note: a semantic snapshot is available in the DOM as:',
            '- `<script id="__vacp_snapshot" type="application/json">{...}</script>`',
            '',
            `Task: ${ctx.scenario.task}`,
            '',
            'Hard constraints (must follow):',
            '- Treat the repository, local filesystem, and run artifacts as off-limits.',
            `- Do NOT use the \`read\` tool on anything except screenshots you create for this run: "${ctx.run.outDir}/step-00.png", "${ctx.run.outDir}/step-01.png", ...`,
            '- Run all `agent-browser ...` commands via the `bash` tool (do not just paste commands as text).',
            '- Do NOT use the `bash` tool for anything except `agent-browser ...` commands (no `ls`, `cat`, `rg`, scripting, etc).',
            '- Do NOT try to solve by inspecting source files, configs, logs, or `.agent-arena/**` outputs.',
            '',
            'Rules:',
            '- Do not start solving until a chart is visibly rendered (not a blank/loading screen).',
            '- Do NOT reload/refresh/re-open the page while waiting for the initial chart render.',
            '- Ground your answer ONLY in evidence you obtain through genuine interaction with the app in this run (screenshots + visible UI changes). Do NOT use memorized/prior knowledge of the dataset/chart to answer.',
            `- Chart-ready sentinel: write "${ctx.run.outDir}/${CHART_READY_SCREENSHOT_NAME}" and READ it; only proceed once the chart is clearly visible.`,
            `- Visual grounding: after each meaningful interaction, write and READ "${ctx.run.outDir}/step-01.png", "step-02.png", ... (two digits). Use the screenshots to decide next actions.`,
            '',
            ...agentBrowserEfficiencyGuidance(ctx),
            '',
            ...snapshotDomEfficiencyGuidance(),
            '',
            'Start:',
            `- (bash) Open: \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} open '${ctx.scenario.url}'\``,
            `- (bash) Wait (minimum 5s): \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} wait 5000\``,
            `- (bash) Wait for chart render: \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} wait "${CHART_READY_SELECTOR}"\``,
            `- (bash) Screenshot (chart-ready sentinel): \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} screenshot --full "${ctx.run.outDir}/${CHART_READY_SCREENSHOT_NAME}"\``,
            `- Verify (read screenshot): use the \`read\` tool on "${ctx.run.outDir}/${CHART_READY_SCREENSHOT_NAME}". If the chart is not visible yet, wait 5s and overwrite step-00.png again (no reload) until it is.`,
            `- (bash) Screenshot (after each interaction): \`${AGENT_BROWSER} --session ${ctx.opencode.sessionID} screenshot --full "${ctx.run.outDir}/step-01.png"\` (then step-02.png, step-03.png, ...)`,
            '',
            'Final answer (must follow, exact formatting):',
            `- Answer: on its own line, then output formatted JSON on the following lines inside \`\`\`json fences\`\`\` (start with \`\`\`json and end with \`\`\`), matching \`${ctx.scenario.responseFormat}\`.`,
            '- Reasoning: 1-3 sentences (brief) on its own line after the Answer JSON fence (do not include reasoning inside the JSON).',
            '- Reflection: 2-5 sentences (brief) on its own line. MUST include: (1) `Provenance: interaction-derived` OR `Provenance: prior-knowledge/guess`, (2) confidence (low/medium/high), (3) what was difficult/easy and why + whether your process felt robust or brittle, and (4) the main actions/options you had at your disposal in this run (tools/capabilities/UI interactions) and why you chose the ones you used over the alternatives. If any prior knowledge influenced you, say so explicitly and what you did/did not verify via interaction.',
            '- Screenshot log: after the Reflection, output a bulleted list (one bullet per screenshot you READ), in order, starting with `- step-00.png:`. Each bullet MUST be in the form `- step-01.png: <what you did/tried> | <why> | <what you observed> | <how it moved you closer to the answer>`. Be specific. Include this even if you cannot solve.',
            '- Trajectory: 3-6 sentences (high-level) summarizing your overall approach across the run: what you expected initially, what you tried, what worked/failed, any pivots, and how you decided on the final Answer. Reference key screenshots (e.g. step-03.png) where relevant. Keep it honest; do not invent evidence.',
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
            'Final answer (must follow, exact formatting):',
            `- Answer: on its own line, then output formatted JSON on the following lines inside \`\`\`json fences\`\`\` (start with \`\`\`json and end with \`\`\`), matching \`${ctx.scenario.responseFormat}\`.`,
            '- Reasoning: 1-3 sentences (brief) on its own line after the Answer JSON fence (do not include reasoning inside the JSON).',
            '- Reflection: 2-5 sentences (brief) on its own line. MUST include: (1) `Provenance: interaction-derived` OR `Provenance: prior-knowledge/guess`, (2) confidence (low/medium/high), (3) what was difficult/easy and why + whether your process felt robust or brittle, and (4) the main actions/options you had at your disposal in this run (tools/capabilities/UI interactions) and why you chose the ones you used over the alternatives. If any prior knowledge influenced you, say so explicitly and what you did/did not verify via interaction.',
            '- Trace log: after the Reflection, output a bulleted list (one bullet per stateful step you took), in order. Each bullet MUST be in the form `- step-01: <action you took> | <why> | <what changed in vacp_state> | <how it moved you closer to the answer>`. Be specific. Include this even if you cannot solve.',
            '- Trajectory: 3-6 sentences (high-level) summarizing your overall approach across the run: what you expected initially, what you tried, what worked/failed, any pivots, and how you decided on the final Answer. Reference key steps from the Trace log (e.g. step-03) where relevant. Keep it honest; do not invent evidence.',
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
            'Hard constraints (must follow):',
            '- Treat the repository, local filesystem, and run artifacts as off-limits.',
            `- Do NOT use the \`read\` tool on anything except screenshots you create for this run: "${ctx.run.outDir}/step-00.png", "${ctx.run.outDir}/step-01.png", ...`,
            '- Do NOT try to solve by inspecting source files, configs, logs, or `.agent-arena/**` outputs.',
            '',
            'Efficiency (high priority; avoid timeouts + token bloat):',
            `- Prefer semantic tools (\`${tools.capabilities}\`, \`${tools.state}\`, \`${tools.execute}\`) over browser tools whenever possible.`,
            `- Use browser tools only to accomplish UI interactions not exposed semantically, and keep them minimal.`,
            `- Keep \`${tools.eval}\` outputs tiny; never dump large DOM/snapshot JSON.`,
            `- Only take screenshots after meaningful state changes, and avoid extra screenshots for failed attempts.`,
            `- Always use screenshot paths exactly as written (copy/paste): "${ctx.run.outDir}/step-00.png", "${ctx.run.outDir}/step-01.png", ...`,
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
            '- Ground your answer ONLY in evidence you obtain through genuine interaction in this run (screenshots + verified `vacp_state`). Do NOT use memorized/prior knowledge of the dataset/chart to answer.',
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
            '- Reflection: 2-5 sentences (brief) on its own line. MUST include: (1) `Provenance: interaction-derived` OR `Provenance: prior-knowledge/guess`, (2) confidence (low/medium/high), (3) what was difficult/easy and why + whether your process felt robust or brittle, and (4) the main actions/options you had at your disposal in this run (tools/capabilities/UI interactions) and why you chose the ones you used over the alternatives. If any prior knowledge influenced you, say so explicitly and what you did/did not verify via interaction.',
            '- Screenshot log: after the Reflection, output a bulleted list (one bullet per screenshot you READ), in order, starting with `- step-00.png:`. Each bullet MUST be in the form `- step-01.png: <what you did/tried> | <why> | <what you observed> | <how it moved you closer to the answer>`. Be specific. Include this even if you cannot solve.',
            '- Trajectory: 3-6 sentences (high-level) summarizing your overall approach across the run: what you expected initially, what you tried, what worked/failed, any pivots, and how you decided on the final Answer. Reference key screenshots (e.g. step-03.png) and/or verified `vacp_state` changes where relevant. Keep it honest; do not invent evidence.',
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

const execFileAsync = promisify(execFile);

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
    throw new Error(`agent-browser session still active after close retries: ${sessionID}`);
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
  worktreeRoot: true,
  autoApprove: 'always',
  concurrency: { runs: 4 },
  timeouts: { promptMs: 15 * 60_000 },
  server: { mode: 'connect' },
  onFinished: closeAgentBrowserSession,
  runs,
};

export default config;
