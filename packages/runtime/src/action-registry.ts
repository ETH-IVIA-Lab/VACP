import type {
  VacpActionCall,
  VacpActionDescriptor,
  VacpActionResult,
  VacpActionExecutionOptions,
  VacpSourceId,
  VacpPreparedAction,
  VacpFocus,
  VacpRef,
} from '@vacp/protocol';
import { fnv1a64Hex, VacpActionError } from '@vacp/protocol';

export interface VacpActionExecutor {
  list(): VacpActionDescriptor[];
  prepare(call: VacpActionCall, options?: VacpActionExecutionOptions): Promise<VacpPreparedAction>;
}

export interface VacpActionRegistrar {
  register<Result>(descriptor: VacpActionDescriptor, handler: VacpActionHandler<unknown, Result>): VacpActionDescriptor;
  register<Params, Result>(
    descriptor: VacpActionDescriptor,
    handler: VacpActionHandler<Params, Result>,
    preparation: VacpActionPreparation<Params>,
  ): VacpActionDescriptor;
}

export type VacpActionPreparation<Params> = {
  parse: (value: unknown) => Params | Promise<Params>;
  focus?: (params: Params) => VacpFocus | undefined;
  affects?: (params: Params) => VacpRef[];
};

export type VacpActionHandler<Params = unknown, Result = unknown> = (
  params: Params,
  options: VacpActionExecutionOptions,
) => Result | Promise<Result>;

function toSerializableErrorDetails(cause: unknown): unknown {
  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: cause.message,
      stack: cause.stack,
      cause:
        cause.cause instanceof Error
          ? { name: cause.cause.name, message: cause.cause.message, stack: cause.cause.stack }
          : cause.cause === undefined
            ? undefined
            : String(cause.cause),
    };
  }

  if (cause == null || typeof cause === 'string' || typeof cause === 'number' || typeof cause === 'boolean')
    return cause;

  try {
    return JSON.parse(JSON.stringify(cause));
  } catch {
    return String(cause);
  }
}

/** Stable routing identity for an action owned by one analytical source. */
export function qualifyVacpActionName(sourceId: VacpSourceId, localName: string): string {
  return `source_${fnv1a64Hex(sourceId)}.${localName}`;
}

/**
 * Action registry (concepts).
 *
 * Providers register *semantic* actions here (e.g. "set_interval_2d") rather
 * than wiring agents to DOM events. This is the core of the VACP "control
 * plane".
 *
 * Actions should be a small, explicit set of validated operations exposed by
 * the UI control surface.
 */
export class VacpActionRegistry implements VacpActionExecutor, VacpActionRegistrar {
  private readonly descriptors = new Map<string, VacpActionDescriptor>();
  private readonly handlers = new Map<
    string,
    (params: unknown) => Promise<{ execute: VacpActionHandler; focus?: VacpFocus; affects?: VacpRef[] }>
  >();

  constructor(private readonly sourceId?: VacpSourceId) {}

  register<Result>(descriptor: VacpActionDescriptor, handler: VacpActionHandler<unknown, Result>): VacpActionDescriptor;
  register<Params, Result>(
    descriptor: VacpActionDescriptor,
    handler: VacpActionHandler<Params, Result>,
    preparation: VacpActionPreparation<Params>,
  ): VacpActionDescriptor;
  register<Params = unknown, Result = unknown>(
    descriptor: VacpActionDescriptor,
    handler: VacpActionHandler<Params, Result>,
    preparation?: VacpActionPreparation<Params>,
  ): VacpActionDescriptor {
    const registered = structuredClone(descriptor);
    if (this.sourceId) registered.name = qualifyVacpActionName(this.sourceId, descriptor.name);
    if (this.handlers.has(registered.name)) {
      throw new Error(
        `Duplicate action registration for "${descriptor.name}". Register each action name once (handlers should route via params).`,
      );
    }

    this.descriptors.set(registered.name, registered);
    this.handlers.set(registered.name, async (raw) => {
      const params = preparation ? await preparation.parse(raw) : (raw as Params);
      return {
        execute: (_input, options) => handler(params, options),
        focus: preparation?.focus?.(params),
        affects: preparation?.affects?.(params),
      };
    });
    return structuredClone(registered);
  }

  unregister(name: string): void {
    this.descriptors.delete(name);
    this.handlers.delete(name);
  }

  list(): VacpActionDescriptor[] {
    return structuredClone(Array.from(this.descriptors.values()));
  }

  async prepare(call: VacpActionCall, options: VacpActionExecutionOptions = {}): Promise<VacpPreparedAction> {
    options.signal?.throwIfAborted();
    const prepare = this.handlers.get(call.name);
    const descriptor = this.descriptors.get(call.name);
    if (!prepare || !descriptor) throw new Error(`Unknown action: ${call.name}`);
    const prepared = await prepare(call.params);
    options.signal?.throwIfAborted();
    let used = false;
    return {
      intent: {
        focus: prepared.focus,
        affects: [...new Set([...(descriptor.operation.affects ?? []), ...(prepared.affects ?? [])])],
      },
      execute: async (executionOptions = {}) => {
        if (used) throw new Error('Prepared action has already been executed');
        used = true;
        const signals = [options.signal, executionOptions.signal].filter((signal): signal is AbortSignal => !!signal);
        const signal = AbortSignal.any(signals);
        signal.throwIfAborted();
        try {
          const result = await prepared.execute(undefined, { ...options, ...executionOptions, signal });
          signal.throwIfAborted();
          return { callId: call.callId, ok: true, result };
        } catch (error) {
          signal.throwIfAborted();
          return actionFailure(call, error);
        }
      },
    };
  }

  /** Execute directly when no runtime instrumentation is needed. */
  execute(call: VacpActionCall, options?: VacpActionExecutionOptions): Promise<VacpActionResult> {
    return executeVacpAction(this, call, options);
  }
}

export function actionFailure(call: VacpActionCall, error: unknown): Extract<VacpActionResult, { ok: false }> {
  return {
    callId: call.callId,
    ok: false,
    error: {
      message: error instanceof Error ? error.message : String(error),
      details: error instanceof VacpActionError ? error.details : toSerializableErrorDetails(error),
    },
  };
}

/** Execute the preparation port without lifecycle instrumentation. */
export async function executeVacpAction(
  executor: Pick<VacpActionExecutor, 'prepare'>,
  call: VacpActionCall,
  options?: VacpActionExecutionOptions,
): Promise<VacpActionResult> {
  options?.signal?.throwIfAborted();
  try {
    const prepared = await executor.prepare(call, options);
    return await prepared.execute(options);
  } catch (error) {
    options?.signal?.throwIfAborted();
    return actionFailure(call, error);
  }
}
