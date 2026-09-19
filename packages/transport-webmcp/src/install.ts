import { webMcpExecutionSignal } from './execution.js';
import type { WebMCP } from 'webmcp-types';
import { stableStringify, type VacpGraph } from '@vacp/protocol';
import { compileVacpWebMcpTools } from './compile.js';
import type { VacpWebMcpOptions, VacpWebMcpRegistry, VacpWebMcpSource } from './types.js';

export type VacpWebMcpInstallation = {
  /** Await registration of the live graph or a newer queued revision. Failures reject. */
  refresh(): Promise<void>;
  /** Most recent automatic refresh failure, cleared by the next successful refresh. */
  readonly error: unknown;
  readonly toolNames: readonly string[];
  dispose(): void;
};

type Registration = { controller: AbortController; key: string; tool: WebMCP.ModelContextTool };

function readWithSignal<Value>(read: () => Value | PromiseLike<Value>, signal: AbortSignal): Promise<Value> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    void Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return read();
      })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** Register the current graph and follow capability changes until disposed. */
export async function installVacpWebMcp(
  source: VacpWebMcpSource,
  options: VacpWebMcpOptions & {
    context?: VacpWebMcpRegistry;
    signal?: AbortSignal;
    exposedTo?: string[];
    onError?: (cause: unknown) => void;
  } = {},
): Promise<VacpWebMcpInstallation | undefined> {
  const context = options.context ?? (typeof document === 'undefined' ? undefined : document.modelContext);
  if (!context) return undefined;

  const lifetime = new AbortController();
  const signals = [lifetime.signal, source.signal];
  if (options.signal) signals.push(options.signal);
  const signal = AbortSignal.any(signals);
  signal.throwIfAborted();
  const registrations = new Map<string, Registration>();
  let pending: Promise<void> = Promise.resolve();
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
    const tools = compileVacpWebMcpTools(graph, source, options);
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
          exposedTo: options.exposedTo,
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
        await context.registerTool(
          {
            ...tool,
            execute: async (input, execution) => {
              registrationSignal.throwIfAborted();
              const executionSignal = webMcpExecutionSignal(execution, signal);
              executionSignal.throwIfAborted();
              return entry.tool.execute(input, { signal: executionSignal });
            },
          },
          { signal: registrationSignal, exposedTo: options.exposedTo },
        );
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
    try {
      const snapshot = await readWithSignal(() => source.getCapabilities(), signal);
      await enqueue(snapshot.graph);
    } catch (cause) {
      clear();
      error = cause;
      throw cause;
    }
  };
  try {
    const detach = source.subscribeCapabilities((snapshot) => {
      void enqueue(snapshot.graph).catch((cause) => {
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
