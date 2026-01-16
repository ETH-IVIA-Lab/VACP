import path from 'node:path';
import { consola } from 'consola';
import type { ArenaConfig, ArenaJob, ArenaRunResult } from '../types.js';
import { createClient } from '../opencode.js';
import { buildPrompt, buildTitle, logScenarioStarted } from './helpers.js';
import { TimeoutError, requireData, toErrorPayload, withTimeout, writeJson } from './util.js';

export async function runScenario(args: {
  config: ArenaConfig;
  job: ArenaJob;
  client: ReturnType<typeof createClient>;
  directory: string;
  tools: Record<string, boolean> | undefined;
  outDir: string;
  projectID?: string;
  uiBase?: string;
}): Promise<ArenaRunResult> {
  const startedAt = new Date();
  const scenarioId = args.job.scenario.id ?? 'scenario';
  const promptOutDir = portablePathWithin(args.directory, args.outDir);
  const slug = computeRunSlug(args.job, scenarioId);
  const baseCtx = {
    scenario: args.job.scenario,
    job: args.job,
    run: { outDir: promptOutDir, slug },
    opencode: { directory: args.directory, ...(args.projectID ? { projectID: args.projectID } : {}) },
    ...(args.tools ? { tools: args.tools } : {}),
  };
  const initialTitle = buildTitle(args.config, baseCtx);

  const requestTimeoutMs = 60_000;
  const promptTimeoutMs = args.config.timeouts?.promptMs ?? 10 * 60_000;
  const summarizeTimeoutMs = Math.min(promptTimeoutMs, 3 * 60_000);

  let sessionID: string | undefined;

  try {
    const created = requireData(
      await withTimeout(requestTimeoutMs, 'session.create', (signal) =>
        args.client.session.create({ directory: args.directory, title: initialTitle }, { signal }),
      ),
    );
    sessionID = created.id;

    const ctxWithSession = {
      ...baseCtx,
      opencode: { ...baseCtx.opencode, sessionID: created.id },
    } as const;

    // If a title template wants to incorporate runtime values (like the session ID),
    // update the session title after creation.
    const title = buildTitle(args.config, ctxWithSession);
    if (title !== initialTitle) {
      try {
        requireData(
          await withTimeout(requestTimeoutMs, 'session.update', (signal) =>
            args.client.session.update({ directory: args.directory, sessionID: created.id, title }, { signal }),
          ),
        );
      } catch (error) {
        consola.warn('Failed to update session title', { sessionID: created.id, error });
      }
    }

    const prompt = buildPrompt(args.config, ctxWithSession);

    await writeJson(path.join(args.outDir, 'input.json'), {
      experiment: args.job.experiment,
      model: args.job.model,
      agent: args.job.agent ?? null,
      toolPolicy: args.job.toolPolicy ?? null,
      mcpServers: Object.keys(args.job.mcp?.servers ?? {}),
      mcpAllow: args.job.mcp?.allow ?? null,
      scenario: {
        id: scenarioId,
        url: args.job.scenario.url,
        task: args.job.scenario.task,
      },
      run: {
        outDir: promptOutDir,
        slug,
      },
      opencode: {
        projectID: args.projectID,
        sessionID: created.id,
      },
      title,
      prompt,
      tools: args.tools ?? null,
    });

    const liveUrl = args.uiBase ? `${args.uiBase}/session/${created.id}` : undefined;
    logScenarioStarted({
      experiment: args.job.experiment,
      scenario: { id: scenarioId, url: args.job.scenario.url },
      projectID: args.projectID,
      sessionID: created.id,
      liveUrl,
      outDir: args.outDir,
    });

    requireData(
      await withTimeout(promptTimeoutMs, 'session.prompt', (signal) =>
        args.client.session.prompt(
          {
            directory: args.directory,
            sessionID: created.id,
            model: args.job.model,
            agent: args.job.agent,
            system: args.job.system,
            tools: args.tools,
            parts: [{ type: 'text', text: prompt }],
          },
          { signal },
        ),
      ),
    );

    const summarize = args.job.summarize ?? false;
    if (summarize) {
      const model = args.job.summarizeModel ?? args.job.model;
      await withTimeout(summarizeTimeoutMs, 'session.summarize', (signal) =>
        args.client.session.summarize(
          {
            directory: args.directory,
            sessionID: created.id,
            providerID: model.providerID,
            modelID: model.modelID,
          },
          { signal },
        ),
      );
    }
    return {
      experiment: args.job.experiment,
      scenario: { id: scenarioId, url: args.job.scenario.url },
      projectID: args.projectID,
      sessionID,
      ok: true,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (sessionID && error instanceof TimeoutError) {
      const id = sessionID;
      try {
        await withTimeout(5000, 'session.abort', (signal) =>
          args.client.session.abort({ directory: args.directory, sessionID: id }, { signal }),
        );
      } catch (abortError) {
        consola.warn('Failed to abort timed-out session', { sessionID, abortError });
      }
    }

    return {
      experiment: args.job.experiment,
      scenario: { id: scenarioId, url: args.job.scenario.url },
      projectID: args.projectID,
      sessionID,
      ok: false,
      error: toErrorPayload(error),
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
    };
  }
}

function portablePathWithin(rootDir: string, absPath: string) {
  const root = path.resolve(rootDir);
  const target = path.resolve(absPath);
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return target;
  return rel;
}

function computeRunSlug(job: ArenaJob, scenarioId: string) {
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
