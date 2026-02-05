import fs from 'node:fs/promises';
import path from 'node:path';
import { sanitizeSegment } from '../paths.js';
import type { ArenaJob, ArenaRunResult } from '../types.js';

export type ResumeReuseMode = 'ok' | 'finished';

export type JobArtifactPaths = {
  jobOutDir: string;
  inputJsonPath: string;
  runJsonPath: string;
};

export function computeJobArtifactPaths(args: { arenaOutDir: string; job: ArenaJob; index: number }): JobArtifactPaths {
  const scenarioId = args.job.scenario.id ?? `s${args.index + 1}`;
  const jobOutDir = path.join(
    args.arenaOutDir,
    'runs',
    `experiment=${segment(args.job.experiment)}`,
    `scenario=${segment(scenarioId)}`,
    `modelProvider=${segment(args.job.model.providerID)}`,
    `modelName=${segment(args.job.model.modelID)}`,
  );
  return {
    jobOutDir,
    inputJsonPath: path.join(jobOutDir, 'input.json'),
    runJsonPath: path.join(jobOutDir, 'run.json'),
  };
}

export type JobInspection =
  | {
      state: 'missing';
      reusable: false;
      reason: 'missing_job_dir';
      paths: JobArtifactPaths;
    }
  | {
      state: 'partial';
      reusable: false;
      reason:
        | 'missing_run_json'
        | 'missing_input_json'
        | 'invalid_run_json'
        | 'unfinished_run_json'
        | 'identity_mismatch';
      paths: JobArtifactPaths;
      hasInput: boolean;
      hasRun: boolean;
      runJsonError?: string;
      runJson?: unknown;
    }
  | {
      state: 'complete';
      reusable: boolean;
      reason: 'ok' | 'failed' | 'policy_rerun_failed';
      paths: JobArtifactPaths;
      result: ArenaRunResult;
    };

export async function inspectJob(args: {
  arenaOutDir: string;
  job: ArenaJob;
  index: number;
  reuseMode: ResumeReuseMode;
}): Promise<JobInspection> {
  const paths = computeJobArtifactPaths({ arenaOutDir: args.arenaOutDir, job: args.job, index: args.index });

  const hasJobDir = await exists(paths.jobOutDir);
  if (!hasJobDir) {
    return { state: 'missing', reusable: false, reason: 'missing_job_dir', paths };
  }

  const hasInput = await exists(paths.inputJsonPath);
  const hasRun = await exists(paths.runJsonPath);

  if (!hasRun) {
    if (!hasInput) {
      // The job dir exists but contains no artifacts yet; treat as missing to avoid archiving empty dirs.
      return { state: 'missing', reusable: false, reason: 'missing_job_dir', paths };
    }
    return { state: 'partial', reusable: false, reason: 'missing_run_json', paths, hasInput, hasRun };
  }

  if (!hasInput) {
    return { state: 'partial', reusable: false, reason: 'missing_input_json', paths, hasInput, hasRun };
  }

  const parsed = await readJsonOptional(paths.runJsonPath);
  if (!parsed.ok) {
    return {
      state: 'partial',
      reusable: false,
      reason: 'invalid_run_json',
      paths,
      hasInput,
      hasRun,
      runJsonError: parsed.error,
    };
  }

  const runJson = parsed.value;
  const result = parseArenaRunResult(runJson);
  if (!result) {
    return {
      state: 'partial',
      reusable: false,
      reason: 'invalid_run_json',
      paths,
      hasInput,
      hasRun,
      runJson: runJson,
      runJsonError: 'run.json is missing required fields',
    };
  }

  const finishedAt = result.finishedAt;
  if (!finishedAt || typeof finishedAt !== 'string' || finishedAt.trim().length === 0) {
    return {
      state: 'partial',
      reusable: false,
      reason: 'unfinished_run_json',
      paths,
      hasInput,
      hasRun,
      runJson,
    };
  }

  // Defensive: ensure we don't accidentally reuse a run.json from a different job.
  const expectedScenarioId = args.job.scenario.id ?? `s${args.index + 1}`;
  const identityOk = result.experiment === args.job.experiment && result.scenario.id === expectedScenarioId;
  if (!identityOk) {
    return {
      state: 'partial',
      reusable: false,
      reason: 'identity_mismatch',
      paths,
      hasInput,
      hasRun,
      runJson,
    };
  }

  const reusable = args.reuseMode === 'finished' ? true : result.ok === true;
  if (reusable) {
    return { state: 'complete', reusable: true, reason: result.ok ? 'ok' : 'failed', paths, result };
  }

  return {
    state: 'complete',
    reusable: false,
    reason: 'policy_rerun_failed',
    paths,
    result,
  };
}

export async function archiveJobArtifacts(args: {
  jobOutDir: string;
  reason: string;
  now?: Date;
}): Promise<{ archivedDir: string; moved: string[] } | null> {
  const hasDir = await exists(args.jobOutDir);
  if (!hasDir) return null;

  const entries = await safeReaddir(args.jobOutDir);
  const toMove = entries
    .filter((e) => e.name !== 'attempts')
    .map((e) => e.name)
    .filter(Boolean);
  if (toMove.length === 0) return null;

  const stamp = (args.now ?? new Date()).toISOString().replace(/[:.]/g, '-');
  const reasonSlug = sanitizeSegment(args.reason).slice(0, 60) || 'resume';
  const archivedDir = path.join(args.jobOutDir, 'attempts', `${stamp}__${reasonSlug}`);
  await fs.mkdir(archivedDir, { recursive: true });

  const moved: string[] = [];
  for (const name of toMove) {
    const from = path.join(args.jobOutDir, name);
    const to = path.join(archivedDir, name);
    try {
      await fs.rename(from, to);
      moved.push(name);
    } catch (err) {
      // Best-effort fallback: copy + unlink for files; for directories, surface the error.
      const st = await fs
        .stat(from)
        .then((s) => s)
        .catch(() => null);
      if (!st || st.isDirectory()) throw err;
      await fs.copyFile(from, to);
      await fs.unlink(from);
      moved.push(name);
    }
  }

  await fs.writeFile(
    path.join(archivedDir, 'archive.json'),
    JSON.stringify({ archivedAt: new Date().toISOString(), reason: args.reason, moved }, null, 2) + '\n',
    'utf8',
  );

  return { archivedDir, moved };
}

function segment(value: string) {
  return sanitizeSegment(value) || 'x';
}

async function exists(p: string) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function safeReaddir(p: string) {
  try {
    return await fs.readdir(p, { withFileTypes: true });
  } catch {
    return [];
  }
}

function parseArenaRunResult(value: unknown): ArenaRunResult | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as any;
  if (typeof v.experiment !== 'string') return null;
  if (!v.scenario || typeof v.scenario !== 'object') return null;
  if (typeof v.scenario.id !== 'string') return null;
  if (typeof v.scenario.url !== 'string') return null;
  if (typeof v.ok !== 'boolean') return null;
  if (typeof v.startedAt !== 'string') return null;
  if (typeof v.finishedAt !== 'string') return null;

  const out: ArenaRunResult = {
    experiment: v.experiment,
    scenario: { id: v.scenario.id, url: v.scenario.url },
    ok: v.ok,
    startedAt: v.startedAt,
    finishedAt: v.finishedAt,
    ...(typeof v.projectID === 'string' ? { projectID: v.projectID } : {}),
    ...(typeof v.sessionID === 'string' ? { sessionID: v.sessionID } : {}),
    ...(v.error && typeof v.error === 'object' && typeof v.error.message === 'string'
      ? { error: { message: v.error.message, ...(typeof v.error.stack === 'string' ? { stack: v.error.stack } : {}) } }
      : {}),
  };
  return out;
}

async function readJsonOptional(
  filePath: string,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    try {
      return { ok: true, value: JSON.parse(raw) as unknown };
    } catch (err) {
      return { ok: false, error: `Failed to parse JSON: ${String(err)}` };
    }
  } catch (err) {
    return { ok: false, error: `Failed to read file: ${String(err)}` };
  }
}
