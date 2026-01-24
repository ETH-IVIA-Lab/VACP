import fs from 'node:fs/promises';
import path from 'node:path';
import { consola } from 'consola';
import type { ArenaConfig, ArenaJob, ArenaRunResult } from '../types.js';
import { base64UrlEncode, sanitizeSegment } from '../paths.js';
import { mapLimit } from '../concurrency.js';
import { createClient, startServer } from '../opencode.js';
import { computeTools } from './helpers.js';
import { runScenario } from './scenario.js';
import { requireData, startAutoApprove, writeJson } from './util.js';

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

  const server = await startServer(input.config);
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

    const bootstrapClient = createClient(server.url, requestedDirectory);
    const ocPath = requireData(await bootstrapClient.path.get({ directory: requestedDirectory })) as any;
    const directory = worktreeRoot ? String(ocPath.worktree) : String(ocPath.directory);

    const client = createClient(server.url, directory);

    const mcpRequested = await ensureMcpServers(client, directory, jobs);
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

    const results = await mapLimit(jobs, runConcurrency, async (job, index) => {
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
        consola.warn('afterJob hook failed', { experiment: args.job.experiment, scenario: args.job.scenario.id, error });
      }
      return reused;
    }
  }

  await fs.mkdir(jobOutDir, { recursive: true });

  const tools = computeTools(args.job.toolPolicy, args.job);
  const startedAt = new Date();

  const result = await runScenario({
    config: args.config,
    job: args.job,
    client: args.client,
    directory: args.directory,
    tools,
    outDir: jobOutDir,
    projectID: args.projectID,
    uiBase: args.uiBase,
  });

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

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const status = result.ok ? '✔' : '✖';
  consola.info(`${status} ${args.job.experiment} · ${args.job.scenario.id} (${Math.round(durationMs / 1000)}s)`);
  consola.info(`  Out: ${relativePath(jobOutDir)}`);
  consola.info(`  Run: ${relativePath(runJsonPath)}`);

  return result;
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

async function ensureMcpServers(client: ReturnType<typeof createClient>, directory: string, jobs: ArenaJob[]) {
  const byName = new Map<string, { config: unknown; sources: string[] }>();

  for (const job of jobs) {
    const servers = job.mcp?.servers;
    if (!servers) continue;
    for (const [name, config] of Object.entries(servers)) {
      const existing = byName.get(name);
      if (!existing) {
        byName.set(name, { config, sources: [job.experiment] });
        continue;
      }
      existing.sources.push(job.experiment);
      if (JSON.stringify(existing.config) !== JSON.stringify(config)) {
        consola.warn('Conflicting MCP server config across runs; using the first one', {
          name,
          sources: existing.sources,
        });
      }
    }
  }

  if (byName.size === 0) return undefined;

  const requested = Object.fromEntries(Array.from(byName.entries()).map(([name, v]) => [name, v.sources]));
  for (const [name, info] of byName.entries()) {
    try {
      await client.mcp.add({ directory, name, config: info.config as any });
    } catch (error) {
      consola.warn('Failed to add/connect MCP server', { name, error });
    }
  }
  return requested;
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
