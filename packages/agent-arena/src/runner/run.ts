import fs from 'node:fs/promises';
import path from 'node:path';
import { consola } from 'consola';
import type { ArenaConfig, ArenaJob, ArenaRunResult, FinishedContext } from '../types.js';
import { base64UrlEncode, sanitizeSegment } from '../paths.js';
import { mapLimit } from '../concurrency.js';
import { createClient, startServer } from '../opencode.js';
import { computeTools } from './helpers.js';
import { runScenario } from './scenario.js';
import { portablePathWithin, requireData, startAutoApprove, toErrorPayload, writeJson } from './util.js';

export type ArenaRunInput = {
  config: ArenaConfig;
  outDir: string;
  hooks?: {
    afterJob?: (args: {
      config: ArenaConfig;
      job: ArenaJob;
      index: number;
      outDir: string;
      jobOutDir: string;
      directory: string;
      projectID?: string;
      uiBase: string;
      result: ArenaRunResult;
      client: ReturnType<typeof createClient>;
    }) => Promise<void>;
  };
};

export async function runArena(input: ArenaRunInput): Promise<ArenaRunResult[]> {
  const startedAt = new Date();
  const outDir = input.outDir;

  const jobs = input.config.runs;
  const runConcurrency = input.config.concurrency?.runs ?? 2;

  const server = await startServer(input.config, { arenaStateDir: outDir });
  let approvalsAbort: AbortController | undefined;
  let approvals: Promise<void> | undefined;

  await writeJson(path.join(outDir, 'inputs.json'), {
    startedAt: startedAt.toISOString(),
    worktreeRoot: input.config.worktreeRoot ?? true,
    autoApprove: input.config.autoApprove ?? 'always',
    concurrency: input.config.concurrency ?? {},
    timeouts: input.config.timeouts ?? {},
    runs: jobs.map((job) => ({
      experiment: job.experiment,
      slug: computeRunSlug(job),
      model: job.model,
      agent: job.agent ?? null,
      toolPolicy: job.toolPolicy ?? null,
      mcpServers: Object.keys(job.mcp?.servers ?? {}),
      mcpAllow: job.mcp?.allow ?? null,
      tools: computeTools(job.toolPolicy, job) ?? null,
      scenario: { id: job.scenario.id, url: job.scenario.url, task: job.scenario.task },
    })),
  });

  try {
    const requestedDirectory = path.resolve(input.config.directory ?? input.config.startDirectory ?? process.cwd());
    const worktreeRoot = input.config.worktreeRoot ?? true;

    // In `connect` mode, `server.opencodeConfig` is NOT applied by `opencode serve` automatically.
    // To keep arena runs self-contained (and avoid requiring users to edit global OpenCode config),
    // write a local `opencode.json` into the arena directory (which is typically `.agent-arena/`).
    //
    // This intentionally only auto-writes when the directory basename is `.agent-arena` to avoid
    // surprising config/secrets writes into arbitrary project roots.
    const bootstrapClient = createClient(server.url, requestedDirectory);
    await ensureLocalOpencodeConfigForConnectMode({
      arenaConfig: input.config,
      directory: requestedDirectory,
      client: bootstrapClient,
    });

    const ocPath = requireData(await bootstrapClient.path.get({ directory: requestedDirectory })) as any;
    const directory = worktreeRoot ? String(ocPath.worktree) : String(ocPath.directory);

    const client = createClient(server.url, directory);

    const mcpRequested = computeMcpRequested(jobs);
    approvalsAbort = new AbortController();
    approvals = startAutoApprove({
      client,
      directory,
      mode: input.config.autoApprove ?? 'always',
      signal: approvalsAbort.signal,
    });

    const uiBase = `${server.url}/${base64UrlEncode(directory)}`;
    const projectID = await resolveProjectID(client, directory);

    if (projectID) consola.info(`OpenCode project: ${projectID.slice(0, 8)}`);
    consola.info(`OpenCode UI base: ${uiBase}`);

    await writeJson(path.join(outDir, 'context.json'), {
      projectID,
      uiBase,
      mcpRequested,
    });

    const withLocks = createNameLocks();
    const results = await mapLimit(jobs, runConcurrency, async (job, index) => {
      const lockNames = job.mcp?.servers ? Object.keys(job.mcp.servers) : [];
      return await withLocks(lockNames, async () => {
        return await runJob({
          config: input.config,
          job,
          index,
          outDir,
          client,
          directory,
          projectID,
          uiBase,
          hooks: input.hooks,
        });
      });
    });

    await writeJson(path.join(outDir, 'results.json'), results);
    return results;
  } finally {
    try {
      approvalsAbort?.abort();
    } catch {}
    try {
      await approvals;
    } catch {}
    await server.close();
  }
}

async function ensureLocalOpencodeConfigForConnectMode(args: {
  arenaConfig: ArenaConfig;
  directory: string;
  client: ReturnType<typeof createClient>;
}) {
  const cfg = args.arenaConfig.server;
  if (!cfg || cfg.mode !== 'connect') return;
  if (!cfg.opencodeConfig || Object.keys(cfg.opencodeConfig).length === 0) return;

  const dirBase = path.basename(path.resolve(args.directory));
  if (dirBase !== '.agent-arena') {
    consola.warn(
      `[agent-arena] server.opencodeConfig is set, but server.mode=\"connect\" cannot inject it automatically (directory is ${args.directory}). ` +
        `Either (1) set directory to a dedicated \".agent-arena\" folder, or (2) configure this provider in your OpenCode config.`,
    );
    return;
  }

  const filePath = path.join(args.directory, 'opencode.json');
  const payload = {
    $schema: 'https://opencode.ai/config.json',
    ...cfg.opencodeConfig,
  } as const;

  const desired = JSON.stringify(payload, null, 2) + '\n';
  const existing = await fs
    .readFile(filePath, 'utf8')
    .then((s) => s)
    .catch(() => null);

  if (existing !== desired) {
    await fs.writeFile(filePath, desired, 'utf8');
  }

  // Ensure OpenCode reloads config + plugins for this directory if an instance is already cached.
  try {
    await args.client.instance.dispose({ directory: args.directory });
  } catch {
    // Best effort; OpenCode will still pick up the file on a fresh instance.
  }
}

async function runJob(args: {
  config: ArenaConfig;
  job: ArenaJob;
  index: number;
  outDir: string;
  client: ReturnType<typeof createClient>;
  directory: string;
  projectID?: string;
  uiBase: string;
  hooks?: ArenaRunInput['hooks'];
}): Promise<ArenaRunResult> {
  const jobOutDir = path.join(
    args.outDir,
    'runs',
    `experiment=${segment(args.job.experiment)}`,
    `scenario=${segment(args.job.scenario.id ?? `s${args.index + 1}`)}`,
    `modelProvider=${segment(args.job.model.providerID)}`,
    `modelName=${segment(args.job.model.modelID)}`,
  );
  const runJsonPath = path.join(jobOutDir, 'run.json');

  if (args.config.resume) {
    const reused = await readRunJson(runJsonPath);
    if (reused?.ok) {
      consola.info(`↷ resume ${args.job.experiment} · ${args.job.scenario.id}`);
      try {
        await args.hooks?.afterJob?.({
          config: args.config,
          job: args.job,
          index: args.index,
          outDir: args.outDir,
          jobOutDir,
          client: args.client,
          directory: args.directory,
          projectID: args.projectID,
          uiBase: args.uiBase,
          result: reused,
        });
      } catch (error) {
        consola.warn('afterJob hook failed', {
          experiment: args.job.experiment,
          scenario: args.job.scenario.id,
          error,
        });
      }

      await callOnFinished({
        config: args.config,
        job: args.job,
        directory: args.directory,
        projectID: args.projectID,
        uiBase: args.uiBase,
        arenaOutDir: args.outDir,
        jobOutDir,
        tools: computeTools(args.job.toolPolicy, args.job),
        result: reused,
        resumed: true,
      });
      return reused;
    }
  }

  await fs.mkdir(jobOutDir, { recursive: true });

  const tools = computeTools(args.job.toolPolicy, args.job);
  const startedAt = new Date();

  let result: ArenaRunResult;
  try {
    await ensureMcpServersForJob(args.client, args.directory, args.job);
    result = await runScenario({
      config: args.config,
      job: args.job,
      client: args.client,
      directory: args.directory,
      tools,
      outDir: jobOutDir,
      projectID: args.projectID,
      uiBase: args.uiBase,
    });
  } catch (error) {
    result = {
      experiment: args.job.experiment,
      scenario: { id: args.job.scenario.id ?? 'scenario', url: args.job.scenario.url },
      projectID: args.projectID,
      sessionID: undefined,
      ok: false,
      error: toErrorPayload(error),
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
    };
  }

  try {
    await args.hooks?.afterJob?.({
      config: args.config,
      job: args.job,
      index: args.index,
      outDir: args.outDir,
      jobOutDir,
      client: args.client,
      directory: args.directory,
      projectID: args.projectID,
      uiBase: args.uiBase,
      result,
    });
  } catch (error) {
    consola.warn('afterJob hook failed', { experiment: args.job.experiment, scenario: args.job.scenario.id, error });
  }

  await writeJson(runJsonPath, result);

  await callOnFinished({
    config: args.config,
    job: args.job,
    directory: args.directory,
    projectID: args.projectID,
    uiBase: args.uiBase,
    arenaOutDir: args.outDir,
    jobOutDir,
    tools,
    result,
    resumed: false,
  });

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const status = result.ok ? '✔' : '✖';
  consola.info(`${status} ${args.job.experiment} · ${args.job.scenario.id} (${Math.round(durationMs / 1000)}s)`);
  consola.info(`  Out: ${relativePath(jobOutDir)}`);
  consola.info(`  Run: ${relativePath(runJsonPath)}`);

  return result;
}

async function callOnFinished(args: {
  config: ArenaConfig;
  job: ArenaJob;
  directory: string;
  projectID?: string;
  uiBase: string;
  arenaOutDir: string;
  jobOutDir: string;
  tools: Record<string, boolean> | undefined;
  result: ArenaRunResult;
  resumed: boolean;
}) {
  const hook = args.job.onFinished ?? args.config.onFinished;
  if (!hook) return;

  const outDir = portablePathWithin(args.directory, args.jobOutDir);
  const slug = computeRunSlug(args.job);
  const sessionID = args.result.sessionID;
  const liveUrl = sessionID ? `${args.uiBase}/session/${sessionID}` : undefined;

  const ctx: FinishedContext = {
    scenario: args.job.scenario,
    job: args.job,
    run: { outDir, slug },
    opencode: {
      directory: args.directory,
      ...(args.projectID ? { projectID: args.projectID } : {}),
      ...(sessionID ? { sessionID } : {}),
    },
    ...(args.tools ? { tools: args.tools } : {}),
    result: args.result,
    resumed: args.resumed,
    meta: {
      arenaOutDir: args.arenaOutDir,
      jobOutDir: args.jobOutDir,
      inputJsonPath: path.join(args.jobOutDir, 'input.json'),
      runJsonPath: path.join(args.jobOutDir, 'run.json'),
      uiBase: args.uiBase,
      liveUrl,
    },
  };

  try {
    await hook(ctx);
  } catch (error) {
    consola.warn('onFinished hook failed', { experiment: args.job.experiment, scenario: args.job.scenario.id, error });
  }
}

async function readRunJson(filePath: string): Promise<ArenaRunResult | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as ArenaRunResult;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function relativePath(p: string) {
  const abs = path.resolve(p);
  const rel = path.relative(process.cwd(), abs);
  return rel && !rel.startsWith('..') ? rel : abs;
}

async function resolveProjectID(client: ReturnType<typeof createClient>, directory: string) {
  try {
    const project = requireData(await client.project.current({ directory })) as any;
    return typeof project?.id === 'string' ? project.id : undefined;
  } catch (error) {
    consola.warn('Failed to resolve current OpenCode project', { directory, error });
    return undefined;
  }
}

function computeMcpRequested(jobs: ArenaJob[]) {
  const byName = new Map<string, { sources: string[] }>();

  for (const job of jobs) {
    const servers = job.mcp?.servers;
    if (!servers) continue;
    for (const name of Object.keys(servers)) {
      const existing = byName.get(name);
      if (!existing) {
        byName.set(name, { sources: [job.experiment] });
        continue;
      }
      existing.sources.push(job.experiment);
    }
  }

  if (byName.size === 0) return undefined;

  return Object.fromEntries(Array.from(byName.entries()).map(([name, v]) => [name, v.sources]));
}

async function ensureMcpServersForJob(client: ReturnType<typeof createClient>, directory: string, job: ArenaJob) {
  const servers = job.mcp?.servers;
  if (!servers || Object.keys(servers).length === 0) return;

  for (const [name, config] of Object.entries(servers)) {
    const statusMap = requireData(await client.mcp.add({ directory, name, config: config as any }));
    const status = (statusMap as any)?.[name];
    if (status?.status === 'connected') continue;

    const detail = (() => {
      try {
        return JSON.stringify(status);
      } catch {
        return String(status);
      }
    })();
    throw new Error(`Failed to start MCP server "${name}": ${detail}`);
  }
}

function computeRunSlug(job: ArenaJob) {
  const scenarioId = job.scenario.id ?? 'scenario';
  return [job.model.providerID, job.model.modelID, job.experiment, scenarioId].map(slugSegment).join('__');
}

function slugSegment(input: string) {
  const v = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return v || 'x';
}

function segment(value: string) {
  return sanitizeSegment(value) || 'x';
}

function createNameLocks() {
  const tails = new Map<string, Promise<void>>();

  async function acquire(name: string) {
    const prev = tails.get(name) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    tails.set(
      name,
      prev.then(() => next).catch(() => next),
    );
    await prev;
    return release;
  }

  return async function withLocks<T>(names: string[], fn: () => Promise<T>) {
    const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean))).sort();
    if (unique.length === 0) return await fn();

    const releases: Array<() => void> = [];
    for (const name of unique) releases.push(await acquire(name));
    try {
      return await fn();
    } finally {
      for (const release of releases.reverse()) {
        try {
          release();
        } catch {}
      }
    }
  };
}
