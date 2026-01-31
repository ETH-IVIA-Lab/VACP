import fs from 'node:fs/promises';
import path from 'node:path';

export type ArenaAnalysisMeta = {
  runId?: string;
  runDir?: string;
  generatedAt?: string;
  uiBase?: string | null;
  configPath?: string | null;
  configSha256?: string | null;
  scenariosPath?: string | null;
  scenariosSha256?: string | null;
  [k: string]: unknown;
};

export type ArenaRunRow = Record<string, unknown> & {
  experiment?: string;
  scenario_id?: string;
  model_provider?: string;
  model_name?: string;
};

export type ArenaToolCallRow = Record<string, unknown> & {
  tool?: string;
  status?: string;
  duration_ms?: number | null;
};

export type ArenaAnalysis = {
  analysisDir: string;
  meta: ArenaAnalysisMeta | null;
  runs: ArenaRunRow[];
  toolCalls: ArenaToolCallRow[];
};

export async function loadArenaAnalysis(analysisDirRaw: string): Promise<ArenaAnalysis> {
  const analysisDir = path.resolve(analysisDirRaw);
  const metaPath = path.join(analysisDir, 'meta.json');
  const meta = (await readJsonOptional(metaPath)) as ArenaAnalysisMeta | null;

  const runs = (await readRows(await resolveAny(analysisDir, ['runs.json', 'runs.jsonl']))) as ArenaRunRow[];
  const toolCallsPath = await resolveAnyOptional(analysisDir, ['tool_calls.json', 'tool_calls.jsonl']);
  const toolCalls = toolCallsPath ? ((await readRows(toolCallsPath)) as ArenaToolCallRow[]) : [];

  return { analysisDir, meta, runs, toolCalls };
}

async function resolveAny(dir: string, names: string[]) {
  return (await resolveAnyOptional(dir, names)) ?? fail(`Expected one of: ${names.join(', ')} under ${dir}`);
}

async function resolveAnyOptional(dir: string, names: string[]) {
  for (const name of names) {
    const filePath = path.join(dir, name);
    if (await fileExists(filePath)) return filePath;
  }
  return null;
}

async function fileExists(filePath: string) {
  try {
    const st = await fs.stat(filePath);
    return st.isFile();
  } catch {
    return false;
  }
}

function fail(message: string): never {
  throw new Error(message);
}

async function readJsonOptional(filePath: string) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch (error) {
    if (isErrno(error) && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readRows(filePath: string): Promise<unknown[]> {
  const raw = await fs.readFile(filePath, 'utf8');
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) throw new Error(`Expected JSON array: ${filePath}`);
    return parsed;
  }

  // JSONL
  const rows: unknown[] = [];
  for (const line of raw.split(/\r?\n/g)) {
    const t = line.trim();
    if (!t) continue;
    rows.push(JSON.parse(t) as unknown);
  }
  return rows;
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}
