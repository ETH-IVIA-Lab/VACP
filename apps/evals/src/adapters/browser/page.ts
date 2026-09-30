import {
  VACP_SCHEMA_VERSION,
  type VacpActor,
  type VacpAgentActivityHandle,
  type VacpCapabilitiesRequest,
  type VacpGraph,
  type VacpStateRequest,
} from '@vacp/protocol';
import { compileVacpWebMcpTools } from '@vacp/transport-webmcp';
import type { BrowserContext, Page } from 'playwright';
import type { ExampleOptions } from '../../../../../examples/config';

import { resolveAction } from '../../core/resolve';
import type { Act, ExecutionRecord } from '../../core/scenario';
import { ToolError, type AgentBridge, type AgentPage, type PageTool } from '../../ports';
import './globals';

/** Agent steps run unpaced, so latency measures VACP itself. */
const exampleOptions: Partial<ExampleOptions> = {
  paceAgentSteps: false,
  webmcp: true,
  exposeBridge: true,
  enableSql: true,
};

/** `work`, unless `ms` pass or `signal` aborts first. A page that stops answering cannot hold a run. */
function within<T>(work: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const stop = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`No answer from the page within ${Math.round(ms)}ms`)), ms);
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  return Promise.race([work, stop]).finally(() => {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort!);
  });
}

/** The browser page one run works on. Conditions read and act through it, and the runner grades it. */
export class EvalPage implements AgentPage {
  readonly bridge: AgentBridge;

  private constructor(
    readonly page: Page,
    readonly url: string,
  ) {
    this.bridge = remoteBridge(page);
  }

  static async open(context: BrowserContext, url: string, signal: AbortSignal): Promise<EvalPage> {
    await context.addInitScript((options) => {
      globalThis.__vacpExampleOptions = { ...globalThis.__vacpExampleOptions, ...options };
    }, exampleOptions);
    const page = await context.newPage();
    const opened = new EvalPage(page, url);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await opened.ready(signal);
    // One run log: phases from the execution stream, parameters from the provenance record.
    await page.evaluate(() => {
      const log = { entries: new Map<string, ExecutionRecord>(), settled: new Set<string>() };
      const params = new Map<string, unknown>();
      globalThis.__vacpEvalLog = log;
      globalThis.__vacp.subscribeProvenance(({ record }) => {
        if (record?.kind !== 'action') return;
        const entry = log.entries.get(record.execution.id);
        if (entry) entry.params = record.call.params;
        else params.set(record.execution.id, record.call.params);
      });
      globalThis.__vacp.subscribeExecutions((execution) => {
        const entry: ExecutionRecord = log.entries.get(execution.id) ?? {
          id: execution.id,
          name: execution.name,
          operation: execution.operationKind,
          actor: execution.actor.kind,
          phase: 'succeeded',
          phases: [],
          sourceId: execution.sourceId,
        };
        entry.phases.push({ phase: execution.phase, at: execution.at });
        // The runtime resolves the operation and its source after it accepts the call.
        entry.operation = execution.operationKind ?? entry.operation;
        entry.sourceId = execution.sourceId ?? entry.sourceId;
        entry.narration = execution.narration ?? entry.narration;
        entry.message = execution.message ?? entry.message;
        // The page cannot import protocol helpers, so the settled phases are listed here.
        if (execution.phase === 'succeeded' || execution.phase === 'failed' || execution.phase === 'cancelled') {
          entry.phase = execution.phase;
          log.settled.add(execution.id);
        }
        if (params.has(execution.id)) {
          entry.params = params.get(execution.id);
          params.delete(execution.id);
        }
        log.entries.set(execution.id, entry);
      });
    });
    return opened;
  }

  /** Executions that settled since the last call, each once, in the order they began. */
  async executions(): Promise<ExecutionRecord[]> {
    return this.page.evaluate(() => {
      const log = globalThis.__vacpEvalLog!;
      const settled = [...log.entries.values()].filter((entry) => log.settled.has(entry.id));
      for (const { id } of settled) {
        log.entries.delete(id);
        log.settled.delete(id);
      }
      return settled;
    });
  }

  /**
   * The page is ready when its WebMCP registry holds every tool the transport compiles for the
   * observed graph, and every output the observation reports has rendered its current input. The
   * examples install WebMCP with the transport's default options, which the compiled names assume.
   */
  private async ready(signal: AbortSignal, timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      const catalog = await within(
        this.page.evaluate(async () => {
          if (!('__vacp' in globalThis) || !document.modelContext) return null;
          const [observation, tools] = await Promise.all([
            globalThis.__vacp.observe(),
            document.modelContext.getTools(),
          ]);
          const settled = Object.values(observation.freshness ?? {}).every(
            (freshness) => freshness.status === 'current' || freshness.status === 'error',
          );
          return { graph: observation.graph, registered: tools.map((tool) => tool.name), settled };
        }),
        deadline - Date.now(),
        signal,
      ).catch((error: unknown) => {
        if (signal.aborted) throw error;
        return null;
      });
      if (catalog?.settled) {
        const registered = new Set(catalog.registered);
        if (compileVacpWebMcpTools(catalog.graph, this.bridge).every((tool) => registered.has(tool.name))) return;
      }
      await this.page.waitForTimeout(100);
    }
    throw new Error(`Page ${this.url} did not register its WebMCP tools within ${timeoutMs / 1000}s`);
  }

  async tools(): Promise<PageTool[]> {
    return this.page.evaluate(async () =>
      (await document.modelContext!.getTools()).map((tool) => ({
        name: tool.name,
        description: tool.description,
        // Chromium reports a registered tool's input schema as JSON text.
        inputSchema: JSON.parse(String(tool.inputSchema ?? '{"type":"object","properties":{}}')) as Record<
          string,
          unknown
        >,
      })),
    );
  }

  async callTool(name: string, input: unknown): Promise<string> {
    const outcome = await this.page.evaluate(
      async ({ name, input }) => {
        const tool = (await document.modelContext!.getTools()).find((each) => each.name === name);
        if (!tool) return { error: `Tool ${name} is not registered on this page.` };
        try {
          const result = await document.modelContext!.executeTool(tool, JSON.stringify(input ?? {}));
          return { result: typeof result === 'string' ? result : JSON.stringify(result) };
        } catch (error) {
          return { error: `${(error as Error)?.name ?? 'Error'}: ${(error as Error)?.message ?? String(error)}` };
        }
      },
      { name, input },
    );
    if ('error' in outcome) throw new ToolError(outcome.error);
    return outcome.result;
  }

  async state(): Promise<Record<string, unknown>> {
    return (await this.bridge.getState()).state as Record<string, unknown>;
  }

  async graph(): Promise<VacpGraph> {
    return (await this.bridge.getCapabilities()).graph;
  }

  async text(selector: string): Promise<string | null> {
    const element = this.page.locator(selector).first();
    if (!(await element.count())) return null;
    return (await element.innerText()).replace(/\s+/g, ' ').trim();
  }

  async act(act: Act, actor: VacpActor): Promise<unknown> {
    const result = await this.bridge.execute(
      { callId: crypto.randomUUID(), name: resolveAction(await this.graph(), act), params: act.params },
      { actor, narration: act.narration ?? `Running ${act.action}.` },
    );
    if (!result.ok) throw new Error(`${act.action} failed: ${result.error.message}`);
    return result.result;
  }
}

/**
 * `window.__vacp` across the Playwright boundary. Playwright serializes each function and its argument,
 * so signals and callbacks stay on this side and activity handles are kept in the page by id.
 */
function remoteBridge(page: Page): AgentBridge {
  const quietly = (work: Promise<unknown>) => void work.catch(() => {});
  const getCapabilities = (request?: VacpCapabilitiesRequest) =>
    request
      ? page.evaluate((request) => globalThis.__vacp.getCapabilities(request), request)
      : page.evaluate(() => globalThis.__vacp.getCapabilities());
  const getState = (request?: VacpStateRequest) =>
    request
      ? page.evaluate((request) => globalThis.__vacp.getState(request), request)
      : page.evaluate(() => globalThis.__vacp.getState());
  return {
    version: VACP_SCHEMA_VERSION,
    observe: () => page.evaluate(() => globalThis.__vacp.observe()),
    // One implementation serves both overloads of each read, which TypeScript cannot check against them.
    getCapabilities: getCapabilities as AgentBridge['getCapabilities'],
    getState: getState as AgentBridge['getState'],
    execute: (call, options) =>
      page.evaluate(({ call, options }) => globalThis.__vacp.execute(call, options), {
        call,
        options: options && { actor: options.actor, narration: options.narration },
      }),
    beginAgentActivity: ({ actor, summary }) => {
      const id = crypto.randomUUID();
      quietly(
        page.evaluate(
          ({ id, actor, summary }) => {
            const turns = (globalThis.__vacpEvalTurns ??= new Map());
            turns.set(id, globalThis.__vacp.beginAgentActivity({ actor, summary }));
          },
          { id, actor, summary },
        ),
      );
      const call = (method: keyof VacpAgentActivityHandle, arg?: unknown) =>
        quietly(
          page.evaluate(
            ({ id, method, arg }) => {
              const turn = globalThis.__vacpEvalTurns?.get(id);
              (turn?.[method] as ((arg: unknown) => void) | undefined)?.(arg);
              if (method === 'end') globalThis.__vacpEvalTurns?.delete(id);
            },
            { id, method, arg },
          ),
        );
      return { update: (summary) => call('update', summary), end: (options) => call('end', options) };
    },
  };
}
