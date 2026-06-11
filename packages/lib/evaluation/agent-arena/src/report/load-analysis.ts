import fs from 'node:fs/promises';
import path from 'node:path';

export type ArenaAnalysisMeta = {
  runId?: string | null;
  runDir?: string;
  generatedAt?: string;
  uiBase?: string | null;
  opencodeLogSource?: string | null;
  opencodeExportManifest?: string | null;
  opencodeExportCounts?: {
    jobs?: number;
    jobsWithSession?: number;
    messagesJson?: number;
    sessionJson?: number;
    toolCallsJson?: number;
    messages?: number;
    parts?: number;
    [k: string]: unknown;
  } | null;
  configPath?: string | null;
  configSha256?: string | null;
  scenariosPath?: string | null;
  scenariosSha256?: string | null;
  analysisSources?: ArenaAnalysisSource[];
  [k: string]: unknown;
};

export type ArenaAnalysisSource = {
  analysisDir: string;
  runId: string | null;
  runDir: string | null;
  generatedAt: string | null;
  runs: number;
  toolCalls: number;
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
  analysisDirs: string[];
  meta: ArenaAnalysisMeta | null;
  runs: ArenaRunRow[];
  toolCalls: ArenaToolCallRow[];
};

export type ArenaAnalysisInput = string | readonly string[];

export async function loadArenaAnalysis(analysisInput: ArenaAnalysisInput): Promise<ArenaAnalysis> {
  const analysisDirs = normalizeAnalysisDirs(analysisInput);
  if (analysisDirs.length === 1) return loadSingleArenaAnalysis(analysisDirs[0]);

  const analyses = await Promise.all(analysisDirs.map((analysisDir) => loadSingleArenaAnalysis(analysisDir)));
  return mergeArenaAnalyses(analyses);
}

export function normalizeAnalysisDirs(analysisInput: ArenaAnalysisInput): string[] {
  const values = Array.isArray(analysisInput) ? analysisInput : [analysisInput];
  const dirs = values
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => path.resolve(value));
  if (!dirs.length) throw new Error('Expected at least one analysis directory.');
  return dirs;
}

async function loadSingleArenaAnalysis(analysisDirRaw: string): Promise<ArenaAnalysis> {
  const analysisDir = path.resolve(analysisDirRaw);
  const metaPath = path.join(analysisDir, 'meta.json');
  const meta = (await readJsonOptional(metaPath)) as ArenaAnalysisMeta | null;

  const runs = (await readRows(await resolveAny(analysisDir, ['runs.json', 'runs.jsonl']))) as ArenaRunRow[];
  const toolCallsPath = await resolveAnyOptional(analysisDir, ['tool_calls.json', 'tool_calls.jsonl']);
  const toolCalls = toolCallsPath ? ((await readRows(toolCallsPath)) as ArenaToolCallRow[]) : [];

  return { analysisDir, analysisDirs: [analysisDir], meta, runs, toolCalls };
}

function mergeArenaAnalyses(analyses: ArenaAnalysis[]): ArenaAnalysis {
  const analysisDirs = analyses.flatMap((analysis) => analysis.analysisDirs);
  const analysisDir = commonParent(analysisDirs);
  const sources = analyses.map((analysis) => analysisSource(analysis));

  const runs = analyses.flatMap((analysis, index) =>
    analysis.runs.map((row) => ({
      ...row,
      analysis_source_dir: analysis.analysisDir,
      analysis_source_index: index,
    })),
  );
  const toolCalls = analyses.flatMap((analysis, index) =>
    analysis.toolCalls.map((row) => ({
      ...row,
      analysis_source_dir: analysis.analysisDir,
      analysis_source_index: index,
    })),
  );

  const primaryMeta = analyses.find((analysis) => analysis.meta)?.meta ?? null;
  const runIds = Array.from(new Set(sources.flatMap((source) => (source.runId ? [source.runId] : []))));
  const generatedAtValues = sources.flatMap((source) => (source.generatedAt ? [source.generatedAt] : []));
  const generatedAt = generatedAtValues.length ? generatedAtValues.sort()[generatedAtValues.length - 1] : undefined;

  const meta: ArenaAnalysisMeta = {
    ...primaryMeta,
    runId: runIds.length === 1 ? runIds[0] : null,
    ...(generatedAt ? { generatedAt } : {}),
    analysisSources: sources,
  };

  return { analysisDir, analysisDirs, meta, runs, toolCalls };
}

function analysisSource(analysis: ArenaAnalysis): ArenaAnalysisSource {
  return {
    analysisDir: analysis.analysisDir,
    runId: typeof analysis.meta?.runId === 'string' ? analysis.meta.runId : null,
    runDir: typeof analysis.meta?.runDir === 'string' ? analysis.meta.runDir : null,
    generatedAt: typeof analysis.meta?.generatedAt === 'string' ? analysis.meta.generatedAt : null,
    runs: analysis.runs.length,
    toolCalls: analysis.toolCalls.length,
  };
}

function commonParent(paths: string[]) {
  if (paths.length === 1) return paths[0];
  const split = paths.map((p) => path.resolve(p).split(path.sep).filter(Boolean));
  const first = split[0] ?? [];
  let i = 0;
  while (i < first.length && split.every((parts) => parts[i] === first[i])) i += 1;
  const prefix = first.slice(0, i);
  if (!prefix.length) return path.parse(paths[0]).root;
  return `${path.sep}${prefix.join(path.sep)}`;
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
