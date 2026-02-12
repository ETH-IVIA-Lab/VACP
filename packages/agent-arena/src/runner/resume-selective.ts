import fs from 'node:fs/promises';
import path from 'node:path';
import { loadArenaAnalysis, type ArenaRunRow } from '../report/load-analysis.js';
import type { ArenaJob } from '../types.js';
import { computeJobIdentity, computeJobIdentityKey, inspectJob, type JobInspection } from './job-state.js';

export const SUPPORTED_RESUME_RERUN_OUTCOMES = ['protocol_failure', 'plumbing_failure'] as const;
export type ResumeRerunOutcome = (typeof SUPPORTED_RESUME_RERUN_OUTCOMES)[number];

export type ResumeForcedRerun = {
  outcome: ResumeRerunOutcome;
  sessionID: string;
  startedAt: string;
  finishedAt: string;
};

export type ResumeOutcomeSelection = {
  runDir: string;
  analysisDir: string;
  analysisRunsPath: string;
  selectedOutcomes: ResumeRerunOutcome[];
  completeJobs: number;
  matchedJobs: number;
  forcedByJobKey: Map<string, ResumeForcedRerun>;
};

type IndexedRunRow = {
  row: ArenaRunRow;
  experiment: string;
  scenarioId: string;
  modelProvider: string;
  modelName: string;
  sessionID: string;
  startedAt: string;
  finishedAt: string;
  evalOutcome: string | null;
  runId: string | null;
};

export function parseResumeRerunOutcomesCsv(value: unknown): ResumeRerunOutcome[] | null {
  if (typeof value !== 'string') return null;
  const rawItems = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!rawItems.length) {
    throw new Error(
      `--rerun-outcomes requires at least one value (${SUPPORTED_RESUME_RERUN_OUTCOMES.join(', ')})`,
    );
  }

  const unknown = rawItems.filter((item) => !isResumeRerunOutcome(item));
  if (unknown.length) {
    throw new Error(
      [
        `Unsupported --rerun-outcomes value(s): ${unknown.join(', ')}`,
        `Supported values: ${SUPPORTED_RESUME_RERUN_OUTCOMES.join(', ')}`,
      ].join('\n'),
    );
  }

  const out: ResumeRerunOutcome[] = [];
  const seen = new Set<ResumeRerunOutcome>();
  for (const item of rawItems as ResumeRerunOutcome[]) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

export async function buildResumeOutcomeSelection(args: {
  runDir: string;
  analysisDir: string;
  jobs: ArenaJob[];
  selectedOutcomes: ResumeRerunOutcome[];
}): Promise<ResumeOutcomeSelection> {
  const runDir = path.resolve(args.runDir);
  const analysisDir = path.resolve(args.analysisDir);
  const runId = path.basename(runDir);
  const selectedOutcomes = uniqueOutcomes(args.selectedOutcomes);
  if (!selectedOutcomes.length) {
    throw new Error(
      `--rerun-outcomes requires at least one value (${SUPPORTED_RESUME_RERUN_OUTCOMES.join(', ')})`,
    );
  }

  const analysisRunsPath = await resolveAnalysisRunsPath(analysisDir);
  const [analysis, inspections, analysisRunsStat] = await Promise.all([
    loadArenaAnalysis(analysisDir),
    Promise.all(
      args.jobs.map((job, index) => inspectJob({ arenaOutDir: runDir, job, index, reuseMode: 'finished' })),
    ),
    fs.stat(analysisRunsPath),
  ]);

  assertAnalysisTargetsRun({
    runDir,
    runId,
    analysisMeta: analysis.meta,
    rows: analysis.runs,
  });

  const completeInspections = inspections.filter((i): i is Extract<JobInspection, { state: 'complete' }> => {
    return i.state === 'complete';
  });

  const latestRunJsonMs = await latestRunJsonMtimeMs(completeInspections);
  if (Number.isFinite(latestRunJsonMs) && latestRunJsonMs > analysisRunsStat.mtimeMs + 1) {
    throw new Error(
      [
        `Analysis appears stale for selective resume.`,
        `Detected newer run artifacts than ${analysisRunsPath}.`,
        `Refresh analysis first: pnpm -C packages/agent-arena start -- analyze --run ${runDir}`,
      ].join('\n'),
    );
  }

  const rows = analysis.runs.map(indexRunRow);
  const rowsByIdentity = groupBy(rows, (row) => identityKeyFromRunRow(row));
  const selectedOutcomeSet = new Set<ResumeRerunOutcome>(selectedOutcomes);

  const forcedByJobKey = new Map<string, ResumeForcedRerun>();
  const staleProblems: string[] = [];
  let matchedJobs = 0;

  for (let index = 0; index < args.jobs.length; index += 1) {
    const inspection = inspections[index];
    if (!inspection || inspection.state !== 'complete') continue;
    const job = args.jobs[index];
    const identity = computeJobIdentity({ job, index });
    const key = computeJobIdentityKey({ job, index });
    const candidates = rowsByIdentity.get(key) ?? [];
    if (!candidates.length) {
      staleProblems.push(
        `${identityToLabel(identity)}: no matching row in analysis/runs.json for current run artifacts`,
      );
      continue;
    }

    const matched = matchRowToRunResult(candidates, inspection.result);
    if (!matched) {
      const sessions = uniqueStrings(candidates.map((row) => row.sessionID));
      staleProblems.push(
        `${identityToLabel(identity)}: unable to match run.json session/time to analysis row (session=${display(inspection.result.sessionID)}, candidates=${sessions.length ? sessions.join(', ') : 'none'})`,
      );
      continue;
    }

    if (!matched.evalOutcome) {
      staleProblems.push(`${identityToLabel(identity)}: matched analysis row is missing eval_outcome`);
      continue;
    }

    matchedJobs += 1;
    if (!isResumeRerunOutcome(matched.evalOutcome)) continue;
    if (!selectedOutcomeSet.has(matched.evalOutcome)) continue;

    forcedByJobKey.set(key, {
      outcome: matched.evalOutcome,
      sessionID: matched.sessionID,
      startedAt: matched.startedAt,
      finishedAt: matched.finishedAt,
    });
  }

  if (staleProblems.length) {
    const shown = staleProblems.slice(0, 20);
    const extra = staleProblems.length - shown.length;
    throw new Error(
      [
        `Analysis is insufficient for selective resume (${analysisDir}).`,
        `Refresh analysis first: pnpm -C packages/agent-arena start -- analyze --run ${runDir}`,
        `Problems:`,
        ...shown.map((line) => `- ${line}`),
        extra > 0 ? `- ... and ${extra} more` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  return {
    runDir,
    analysisDir,
    analysisRunsPath,
    selectedOutcomes,
    completeJobs: completeInspections.length,
    matchedJobs,
    forcedByJobKey,
  };
}

function isResumeRerunOutcome(value: string): value is ResumeRerunOutcome {
  return (SUPPORTED_RESUME_RERUN_OUTCOMES as readonly string[]).includes(value);
}

function uniqueOutcomes(values: ResumeRerunOutcome[]): ResumeRerunOutcome[] {
  const out: ResumeRerunOutcome[] = [];
  const seen = new Set<ResumeRerunOutcome>();
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

async function resolveAnalysisRunsPath(analysisDir: string) {
  for (const name of ['runs.json', 'runs.jsonl']) {
    const filePath = path.join(analysisDir, name);
    const st = await fs.stat(filePath).catch(() => null);
    if (st?.isFile()) return filePath;
  }
  throw new Error(`Expected analysis runs file at ${analysisDir}/runs.json or ${analysisDir}/runs.jsonl`);
}

function assertAnalysisTargetsRun(args: {
  runDir: string;
  runId: string;
  analysisMeta: Record<string, unknown> | null;
  rows: ArenaRunRow[];
}) {
  const metaRunDir = asOptionalString(args.analysisMeta?.runDir);
  if (metaRunDir && path.resolve(metaRunDir) !== args.runDir) {
    throw new Error(
      [
        `Analysis runDir mismatch for selective resume.`,
        `analysis/meta.json runDir: ${path.resolve(metaRunDir)}`,
        `expected runDir:         ${args.runDir}`,
        `Refresh analysis first: pnpm -C packages/agent-arena start -- analyze --run ${args.runDir}`,
      ].join('\n'),
    );
  }

  const metaRunId = asOptionalString(args.analysisMeta?.runId);
  if (metaRunId && metaRunId !== args.runId) {
    throw new Error(
      [
        `Analysis runId mismatch for selective resume.`,
        `analysis/meta.json runId: ${metaRunId}`,
        `expected runId:           ${args.runId}`,
        `Refresh analysis first: pnpm -C packages/agent-arena start -- analyze --run ${args.runDir}`,
      ].join('\n'),
    );
  }

  const runIds = new Set<string>();
  for (const row of args.rows) {
    const runId = asOptionalString((row as any).run_id);
    if (runId) runIds.add(runId);
  }
  if (!runIds.size) return;
  if (runIds.size === 1 && runIds.has(args.runId)) return;
  throw new Error(
    [
      `analysis/runs.json does not match run ${args.runId}.`,
      `Found run_id values: ${Array.from(runIds).sort((a, b) => a.localeCompare(b)).join(', ')}`,
      `Refresh analysis first: pnpm -C packages/agent-arena start -- analyze --run ${args.runDir}`,
    ].join('\n'),
  );
}

async function latestRunJsonMtimeMs(inspections: Array<Extract<JobInspection, { state: 'complete' }>>) {
  let latest = Number.NEGATIVE_INFINITY;
  for (const inspection of inspections) {
    const st = await fs.stat(inspection.paths.runJsonPath).catch(() => null);
    if (!st) continue;
    latest = Math.max(latest, st.mtimeMs);
  }
  return latest;
}

function indexRunRow(row: ArenaRunRow): IndexedRunRow {
  return {
    row,
    experiment: asString((row as any).experiment),
    scenarioId: asString((row as any).scenario_id),
    modelProvider: asString((row as any).model_provider),
    modelName: asString((row as any).model_name),
    sessionID: asString((row as any).session_id),
    startedAt: asString((row as any).started_at),
    finishedAt: asString((row as any).finished_at),
    evalOutcome: asOptionalString((row as any).eval_outcome),
    runId: asOptionalString((row as any).run_id),
  };
}

function identityKeyFromRunRow(row: IndexedRunRow) {
  return [row.experiment, row.scenarioId, row.modelProvider, row.modelName].join('__');
}

function groupBy<T>(rows: T[], toKey: (row: T) => string) {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const key = toKey(row);
    const list = out.get(key);
    if (list) list.push(row);
    else out.set(key, [row]);
  }
  return out;
}

function matchRowToRunResult(rows: IndexedRunRow[], result: { sessionID?: string; startedAt: string; finishedAt: string }) {
  const sessionID = asString(result.sessionID);
  const bySession = rows.filter((row) => row.sessionID === sessionID);
  if (bySession.length === 1) return bySession[0];
  if (bySession.length > 1) return disambiguateRow(bySession, result);
  if (sessionID) return null;

  const byFinished = rows.filter((row) => row.finishedAt && row.finishedAt === result.finishedAt);
  if (byFinished.length === 1) return byFinished[0];

  const byStarted = rows.filter((row) => row.startedAt && row.startedAt === result.startedAt);
  if (byStarted.length === 1) return byStarted[0];

  return rows.length === 1 ? rows[0] : null;
}

function disambiguateRow(rows: IndexedRunRow[], result: { startedAt: string; finishedAt: string }) {
  const byFinished = rows.filter((row) => row.finishedAt && row.finishedAt === result.finishedAt);
  if (byFinished.length === 1) return byFinished[0];
  const byStarted = rows.filter((row) => row.startedAt && row.startedAt === result.startedAt);
  if (byStarted.length === 1) return byStarted[0];
  return null;
}

function identityToLabel(identity: {
  experiment: string;
  scenarioId: string;
  modelProvider: string;
  modelName: string;
}) {
  return `${identity.experiment} · ${identity.scenarioId} · ${identity.modelProvider}/${identity.modelName}`;
}

function uniqueStrings(values: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function asOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function display(value: unknown) {
  const s = asString(value).trim();
  return s || '<empty>';
}
