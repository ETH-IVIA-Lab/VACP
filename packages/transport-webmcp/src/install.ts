import type { WebMCP } from 'webmcp-types';
import { abortable, stableStringify, vacpAgentActor, type VacpGraph } from '@vacp/protocol';
import { compileVacpWebMcpTools } from './compile';
import { createVacpWebMcpProgressTool } from './progress';
import type { VacpWebMcpOptions, VacpWebMcpSource } from './types';

export type VacpWebMcpInstallation = {
  /** Await registration of the live graph or a newer queued revision. Failures reject. */
  refresh(): Promise<void>;
  /** Most recent automatic refresh failure, cleared by the next successful refresh. */
  readonly error: unknown;
  readonly toolNames: readonly string[];
  dispose(): void;
};

type Registration = { controller: AbortController; key: string; tool: WebMCP.ModelContextTool };

/** Register the current graph and follow capability changes until disposed. */
export async function installVacpWebMcp(
  source: VacpWebMcpSource,
  options: VacpWebMcpOptions = {},
): Promise<VacpWebMcpInstallation | undefined> {
  const context = options.context ?? (typeof document === 'undefined' ? undefined : document.modelContext);
  if (!context) return undefined;

  const lifetime = new AbortController();
  const signals = [lifetime.signal, source.signal];
  if (options.signal) signals.push(options.signal);
  const signal = AbortSignal.any(signals);
  signal.throwIfAborted();
  const registrations = new Map<string, Registration>();
  const progress = createVacpWebMcpProgressTool(
    { narrate: source.narrate.bind(source) },
    { actor: options.actor ?? vacpAgentActor, name: `${options.namespace ?? 'vacp'}.progress`, signal },
  );
  let pending: Promise<void> = Promise.resolve();
  let latest = pending;
  let discovery = 0;
  let queued: { graph: VacpGraph; completion: Promise<void> } | undefined;
  let error: unknown;
  let disposed = false;
  let unsubscribe: (() => void) | undefined;

  const clear = () => {
    for (const entry of registrations.values()) entry.controller.abort();
    registrations.clear();
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    lifetime.abort();
    unsubscribe?.();
    clear();
  };
  signal.addEventListener('abort', dispose, { once: true });

  const synchronize = async (graph: VacpGraph) => {
    signal.throwIfAborted();
    const tools = [...compileVacpWebMcpTools(graph, source, options), progress];
    const names = new Set(tools.map((tool) => tool.name));
    for (const [name, entry] of registrations) {
      if (!names.has(name)) {
        entry.controller.abort();
        registrations.delete(name);
      }
    }
    try {
      for (const tool of tools) {
        signal.throwIfAborted();
        const key = stableStringify({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        });
        const previous = registrations.get(tool.name);
        if (previous?.key === key) {
          previous.tool = tool;
          continue;
        }
        previous?.controller.abort();
        const controller = new AbortController();
        const registrationSignal = AbortSignal.any([signal, controller.signal]);
        const entry: Registration = { controller, key, tool };
        registrations.set(tool.name, entry);
        try {
          await context.registerTool(
            {
              ...tool,
              execute: async (input, execution) => {
                registrationSignal.throwIfAborted();
                const executionSignal = execution?.signal ? AbortSignal.any([execution.signal, signal]) : signal;
                executionSignal.throwIfAborted();
                return entry.tool.execute(input, { signal: executionSignal });
              },
            },
            { signal: registrationSignal },
          );
        } catch (cause) {
          signal.throwIfAborted();
          throw new Error(`WebMCP registration failed for ${tool.name}`, { cause });
        }
      }
      error = undefined;
    } catch (cause) {
      clear();
      throw cause;
    }
  };

  const enqueue = (graph: VacpGraph): Promise<void> => {
    // All callers sharing a waiting revision await its completed registration.
    if (queued) {
      queued.graph = graph;
      return queued.completion;
    }
    const request = { graph, completion: Promise.resolve() };
    request.completion = pending.then(() => {
      queued = undefined;
      return synchronize(request.graph);
    });
    queued = request;
    pending = request.completion.catch((cause) => {
      clear();
      error = cause;
    });
    return request.completion;
  };
  const refresh = async () => {
    signal.throwIfAborted();
    const generation = ++discovery;
    // A later read or publication owns discovery, regardless of read completion order.
    const request = abortable(signal, () => source.getCapabilities()).then(
      (snapshot) => (generation === discovery ? enqueue(snapshot.graph) : latest),
      (cause) => {
        signal.throwIfAborted();
        if (generation !== discovery) return latest;
        clear();
        error = cause;
        throw cause;
      },
    );
    latest = request;
    await request;
  };
  try {
    const detach = source.subscribeCapabilities((snapshot) => {
      discovery++;
      latest = enqueue(snapshot.graph);
      void latest.catch((cause) => {
        if (!signal.aborted) options.onError?.(cause);
      });
    });
    if (disposed) detach();
    else unsubscribe = detach;
    await refresh();
    signal.throwIfAborted();
  } catch (cause) {
    dispose();
    throw cause;
  }
  return {
    refresh,
    dispose,
    get error() {
      return error;
    },
    get toolNames() {
      return [...registrations.keys()];
    },
  };
}
