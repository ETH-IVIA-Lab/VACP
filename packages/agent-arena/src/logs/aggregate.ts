import fs from 'node:fs/promises';
import path from 'node:path';

export type AggregatedRunRow = {
  experiment: string;
  scenarioId: string;
  url: string;
  modelProvider: string;
  modelName: string;

  ok: boolean;
  projectID?: string;
  sessionID?: string;
  uiUrl?: string;

  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;

  cost?: number;
  tokensInput?: number;
  tokensOutput?: number;
  tokensReasoning?: number;
  tokensCacheRead?: number;
  tokensCacheWrite?: number;

  toolCalls?: number;
  toolErrors?: number;
  toolTimedCalls?: number;
  toolDurationMs?: number;
  toolsJson?: Record<string, { calls: number; errors: number; durationMs: number }>;

  logDir: string;
};

export async function writeAggregatedMetrics(args: { arenaOutDir: string; outDir: string }) {
  const runsRoot = path.join(args.arenaOutDir, 'runs');
  const inputs = await findFiles(runsRoot, 'input.json');

  const rows: AggregatedRunRow[] = [];
  for (const inputPath of inputs) {
    const jobDir = path.dirname(inputPath);
    const runPath = path.join(jobDir, 'run.json');
    const metricsPath = path.join(jobDir, 'metrics.json');
    const sessionPath = path.join(jobDir, 'session.json');

    const input = (await readJson(inputPath)) as any;
    const run = (await readJsonOrNull(runPath)) as any;
    const metrics = (await readJsonOrNull(metricsPath)) as any;
    const session = (await readJsonOrNull(sessionPath)) as any;

    const experiment = String(input?.experiment ?? '');
    const scenarioId = String(input?.scenario?.id ?? '');
    const url = String(input?.scenario?.url ?? '');
    const modelProvider = String(input?.model?.providerID ?? '');
    const modelName = String(input?.model?.modelID ?? '');

    const ok = Boolean(run?.ok);
    const projectID = typeof run?.projectID === 'string' ? run.projectID : undefined;
    const sessionID = typeof run?.sessionID === 'string' ? run.sessionID : undefined;

    const uiUrl = typeof session?.uiUrl === 'string' ? session.uiUrl : undefined;

    const startedAt = typeof run?.startedAt === 'string' ? run.startedAt : undefined;
    const finishedAt = typeof run?.finishedAt === 'string' ? run.finishedAt : undefined;

    const durationMs = computeDurationMs({ startedAt, finishedAt, metrics });

    rows.push({
      experiment,
      scenarioId,
      url,
      modelProvider,
      modelName,
      ok,
      ...(projectID ? { projectID } : {}),
      ...(sessionID ? { sessionID } : {}),
      ...(uiUrl ? { uiUrl } : {}),
      ...(startedAt ? { startedAt } : {}),
      ...(finishedAt ? { finishedAt } : {}),
      ...(typeof durationMs === 'number' ? { durationMs } : {}),
      ...(typeof metrics?.cost === 'number' ? { cost: metrics.cost } : {}),
      ...(typeof metrics?.tokens?.input === 'number' ? { tokensInput: metrics.tokens.input } : {}),
      ...(typeof metrics?.tokens?.output === 'number' ? { tokensOutput: metrics.tokens.output } : {}),
      ...(typeof metrics?.tokens?.reasoning === 'number' ? { tokensReasoning: metrics.tokens.reasoning } : {}),
      ...(typeof metrics?.tokens?.cacheRead === 'number' ? { tokensCacheRead: metrics.tokens.cacheRead } : {}),
      ...(typeof metrics?.tokens?.cacheWrite === 'number' ? { tokensCacheWrite: metrics.tokens.cacheWrite } : {}),
      ...(typeof metrics?.counts?.toolParts === 'number' ? { toolCalls: metrics.counts.toolParts } : {}),
      ...(typeof metrics?.counts?.toolErrors === 'number' ? { toolErrors: metrics.counts.toolErrors } : {}),
      ...(typeof metrics?.counts?.toolTimedCalls === 'number' ? { toolTimedCalls: metrics.counts.toolTimedCalls } : {}),
      ...(typeof metrics?.counts?.toolDurationMs === 'number' ? { toolDurationMs: metrics.counts.toolDurationMs } : {}),
      ...(metrics?.tools && typeof metrics.tools === 'object' ? { toolsJson: metrics.tools } : {}),
      logDir: path.relative(args.outDir, jobDir) || jobDir,
    });
  }

  rows.sort((a, b) => {
    const k1 = `${a.experiment}__${a.scenarioId}__${a.modelProvider}__${a.modelName}`;
    const k2 = `${b.experiment}__${b.scenarioId}__${b.modelProvider}__${b.modelName}`;
    return k1.localeCompare(k2);
  });

  const jsonlPath = path.join(args.outDir, 'metrics.jsonl');
  await writeJsonl(jsonlPath, rows);

  const csvPath = path.join(args.outDir, 'metrics.csv');
  await writeCsv(csvPath, rows);

  const toolCallsAggPath = path.join(args.outDir, 'tool_calls.jsonl');
  await writeAggregatedToolCalls(toolCallsAggPath, rows, args.outDir);

  return { jsonlPath, csvPath, toolCallsAggPath, rows };
}

function computeDurationMs(args: { startedAt?: string; finishedAt?: string; metrics: any }) {
  const dur = args.metrics?.time?.durationMs;
  if (typeof dur === 'number') return dur;
  if (!args.startedAt || !args.finishedAt) return undefined;
  const s = Date.parse(args.startedAt);
  const e = Date.parse(args.finishedAt);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return undefined;
  return Math.max(0, e - s);
}

async function readJson(filePath: string) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw) as unknown;
}

async function readJsonOrNull(filePath: string) {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

async function findFiles(root: string, fileName: string) {
  const out: string[] = [];
  await walk(root, async (p, ent) => {
    if (ent.isFile() && ent.name === fileName) out.push(p);
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

async function writeJsonl(filePath: string, rows: unknown[]) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const lines = rows.map((row) => JSON.stringify(row));
  await fs.writeFile(filePath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
}

async function writeCsv(filePath: string, rows: AggregatedRunRow[]) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const header = [
    'experiment',
    'scenario_id',
    'url',
    'model_provider',
    'model_name',
    'ok',
    'project_id',
    'session_id',
    'ui_url',
    'started_at',
    'finished_at',
    'duration_ms',
    'cost',
    'tokens_input',
    'tokens_output',
    'tokens_reasoning',
    'tokens_cache_read',
    'tokens_cache_write',
    'tool_calls',
    'tool_errors',
    'tool_timed_calls',
    'tool_duration_ms',
    'tools_json',
    'log_dir',
  ];

  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.experiment,
        r.scenarioId,
        r.url,
        r.modelProvider,
        r.modelName,
        String(r.ok),
        r.projectID ?? '',
        r.sessionID ?? '',
        r.uiUrl ?? '',
        r.startedAt ?? '',
        r.finishedAt ?? '',
        typeof r.durationMs === 'number' ? String(r.durationMs) : '',
        typeof r.cost === 'number' ? String(r.cost) : '',
        typeof r.tokensInput === 'number' ? String(r.tokensInput) : '',
        typeof r.tokensOutput === 'number' ? String(r.tokensOutput) : '',
        typeof r.tokensReasoning === 'number' ? String(r.tokensReasoning) : '',
        typeof r.tokensCacheRead === 'number' ? String(r.tokensCacheRead) : '',
        typeof r.tokensCacheWrite === 'number' ? String(r.tokensCacheWrite) : '',
        typeof r.toolCalls === 'number' ? String(r.toolCalls) : '',
        typeof r.toolErrors === 'number' ? String(r.toolErrors) : '',
        typeof r.toolTimedCalls === 'number' ? String(r.toolTimedCalls) : '',
        typeof r.toolDurationMs === 'number' ? String(r.toolDurationMs) : '',
        r.toolsJson ? JSON.stringify(r.toolsJson) : '',
        r.logDir,
      ]
        .map(csvCell)
        .join(','),
    );
  }

  await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8');
}

function csvCell(value: string) {
  if (value.includes('"') || value.includes(',') || value.includes('\n')) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

async function writeAggregatedToolCalls(filePath: string, rows: AggregatedRunRow[], outDir: string) {
  const all: any[] = [];
  for (const row of rows) {
    const sessionToolCallsPath = path.join(outDir, row.logDir, 'tool_calls.jsonl');
    let raw: string;
    try {
      raw = await fs.readFile(sessionToolCallsPath, 'utf8');
    } catch {
      continue;
    }
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as any;
        all.push({
          experiment: row.experiment,
          scenarioId: row.scenarioId,
          url: row.url,
          modelProvider: row.modelProvider,
          modelName: row.modelName,
          ok: row.ok,
          projectID: row.projectID,
          sessionID: row.sessionID,
          uiUrl: row.uiUrl,
          logDir: row.logDir,
          ...parsed,
        });
      } catch {
        // ignore bad line
      }
    }
  }
  await writeJsonl(filePath, all);
}
