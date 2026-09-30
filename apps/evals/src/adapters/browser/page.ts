import {
  VACP_SCHEMA_VERSION,
  type VacpActor,
  type VacpAgentActivityHandle,
  type VacpCapabilitiesRequest,
  type VacpGraph,
  type VacpStateRequest,
} from '@vacp/protocol';
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

  /** The bridge is installed and the WebMCP catalog has stopped changing for a moment. */
  private async ready(signal: AbortSignal, settleMs = 1200, timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs;
    let last = '';
    let since = Date.now();
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      const names = await this.page
        .evaluate(async () => {
          if (!('__vacp' in globalThis) || !document.modelContext) return '';
          return (await document.modelContext.getTools()).map((tool) => tool.name).join('\n');
        })
        .catch(() => '');
      if (names !== last) {
        last = names;
        since = Date.now();
      } else if (names && Date.now() - since >= settleMs) return;
      await this.page.waitForTimeout(150);
    }
    throw new Error(`Page ${this.url} did not register WebMCP tools within ${timeoutMs / 1000}s`);
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
    narrate: ({ actor, message, done }) =>
      quietly(page.evaluate((input) => globalThis.__vacp.narrate(input), { actor, message, done })),
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
