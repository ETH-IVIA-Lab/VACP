import path from 'node:path';
import { consola } from 'consola';
import type { ArenaConfig, ArenaJob, ArenaRunResult, BeforePromptContext } from '../types.js';
import { createClient } from '../opencode.js';
import { buildPrompt, buildTitle, logScenarioStarted } from './helpers.js';
import { rewritePromptForLane, type McpServerAliases } from './mcp-lane.js';
import {
  portablePathWithin,
  TimeoutError,
  requireData,
  sleep,
  toErrorPayload,
  withTimeout,
  writeJson,
} from './util.js';

export async function runScenario(args: {
  config: ArenaConfig;
  job: ArenaJob;
  client: ReturnType<typeof createClient>;
  directory: string;
  tools: Record<string, boolean> | undefined;
  outDir: string;
  projectID?: string;
  uiBase?: string;
  mcpServerAliases?: McpServerAliases;
  workerID?: number;
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
  const setupTimeoutMs = args.config.timeouts?.setupMs ?? 120_000;
  const promptTimeoutMs = args.config.timeouts?.promptMs ?? 10 * 60_000;
  const summarizeTimeoutMs = Math.min(promptTimeoutMs, 3 * 60_000);

  let sessionID: string | undefined;
  let setup: ArenaRunResult['setup'] | undefined;

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

    const setupHook = args.job.onBeforePrompt ?? args.config.onBeforePrompt;
    const setupHookSource = args.job.onBeforePrompt ? 'job' : 'config';
    if (setupHook) {
      const setupStartedAt = new Date();
      const runtimeMeta =
        args.workerID !== undefined || args.mcpServerAliases
          ? {
              ...(args.workerID !== undefined ? { workerID: args.workerID } : {}),
              ...(args.mcpServerAliases ? { mcpServerAliases: args.mcpServerAliases } : {}),
            }
          : undefined;
      const setupCtx: BeforePromptContext = {
        ...ctxWithSession,
        ...(runtimeMeta ? { runtime: runtimeMeta } : {}),
      };
      try {
        await withTimeout(setupTimeoutMs, 'onBeforePrompt', async (signal) => {
          await setupHook({ ...setupCtx, abortSignal: signal });
        });
        const setupFinishedAt = new Date();
        setup = {
          ok: true,
          hook: setupHookSource,
          startedAt: setupStartedAt.toISOString(),
          finishedAt: setupFinishedAt.toISOString(),
          durationMs: Math.max(0, setupFinishedAt.getTime() - setupStartedAt.getTime()),
        };
      } catch (error) {
        const setupFinishedAt = new Date();
        setup = {
          ok: false,
          hook: setupHookSource,
          startedAt: setupStartedAt.toISOString(),
          finishedAt: setupFinishedAt.toISOString(),
          durationMs: Math.max(0, setupFinishedAt.getTime() - setupStartedAt.getTime()),
          error: toErrorPayload(error),
        };
        throw error;
      }
    }

    const aliases = args.mcpServerAliases ?? {};
    const prompt = rewritePromptForLane(buildPrompt(args.config, ctxWithSession), aliases);
    const system = args.job.system ? rewritePromptForLane(args.job.system, aliases) : args.job.system;

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
      runtime: {
        workerID: args.workerID ?? null,
        mcpServerAliases: args.mcpServerAliases ?? null,
      },
      setup: {
        timeoutMs: setupTimeoutMs,
        hook: setupHook ? setupHookSource : null,
        result: setup ?? null,
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

    await withTimeout(promptTimeoutMs, 'session.prompt', async (signal) => {
      const prompted = await withTimeout(requestTimeoutMs, 'session.promptAsync', (signal) =>
        args.client.session.promptAsync(
          {
            directory: args.directory,
            sessionID: created.id,
            model: args.job.model,
            agent: args.job.agent,
            system,
            tools: args.tools,
            parts: [{ type: 'text', text: prompt }],
          },
          { signal },
        ),
      );
      if (prompted?.error) throw prompted.error;
      await waitForSessionIdle({ client: args.client, directory: args.directory, sessionID: created.id, signal });
    });

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
      ...(setup ? { setup } : {}),
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
      ...(setup ? { setup } : {}),
      error: toErrorPayload(error),
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
    };
  }
}

async function waitForSessionIdle(args: {
  client: ReturnType<typeof createClient>;
  directory: string;
  sessionID: string;
  signal: AbortSignal;
}) {
  const baseDelayMs = 750;
  const startupDelayMs = 250;
  const maxStartupWaitMs = 5000;
  const startupChecks = Math.max(1, Math.floor(maxStartupWaitMs / startupDelayMs));
  let remainingStartupChecks = startupChecks;
  let sawBusy = false;

  while (!args.signal.aborted) {
    const statusMap = requireData(
      await args.client.session.status({ directory: args.directory }, { signal: args.signal }),
    );
    const status = (statusMap as Record<string, unknown>)[args.sessionID] as
      | { type?: string; next?: number }
      | undefined;
    if (!status) {
      if (!sawBusy && remainingStartupChecks > 0) {
        remainingStartupChecks -= 1;
        await sleep(startupDelayMs, args.signal);
        continue;
      }
      return;
    }

    if (status.type === 'busy' || status.type === 'retry') sawBusy = true;
    if (status.type === 'idle') return;

    const delayMs =
      status.type === 'retry' && typeof status.next === 'number'
        ? Math.min(Math.max(status.next - Date.now(), 250), 5000)
        : baseDelayMs;
    await sleep(delayMs, args.signal);
  }

  // Ensure callers using `withTimeout(..., signal => ...)` treat an aborted signal as a timeout.
  throw new Error('waitForSessionIdle aborted');
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
