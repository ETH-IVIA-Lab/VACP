import type {
  VacpActionCall,
  VacpActionDescriptor,
  VacpActionResult,
  VacpActionExecutionOptions,
  VacpSourceId,
  VacpPreparedAction,
  VacpFocus,
  VacpRef,
} from '@ethivia/vacp-protocol';
import { fnv1a64Hex, VacpActionError } from '@ethivia/vacp-protocol';

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

/** Stable routing identity for an action owned by one analytical source. */
function qualifyVacpActionName(sourceId: VacpSourceId, localName: string): string {
  return `source_${fnv1a64Hex(sourceId)}.${localName}`;
}

/** Semantic actions of one source, each validated during preparation before any effect. */
export class VacpActionRegistry implements VacpActionExecutor, VacpActionRegistrar {
  private readonly descriptors = new Map<string, VacpActionDescriptor>();
  private readonly handlers = new Map<
    string,
    (params: unknown) => Promise<{
      execute: (options: VacpActionExecutionOptions) => unknown;
      focus?: VacpFocus;
      affects?: VacpRef[];
    }>
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
      throw new Error(`Duplicate action registration for "${descriptor.name}"`);
    }

    this.descriptors.set(registered.name, registered);
    this.handlers.set(registered.name, async (raw) => {
      const params = preparation ? await preparation.parse(raw) : (raw as Params);
      return {
        execute: (options) => handler(params, options),
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
        const preparedSignal = options.signal;
        const executionSignal = executionOptions.signal;
        const signal =
          preparedSignal && executionSignal && preparedSignal !== executionSignal
            ? AbortSignal.any([preparedSignal, executionSignal])
            : (preparedSignal ?? executionSignal);
        signal?.throwIfAborted();
        try {
          const result = await prepared.execute({ ...options, ...executionOptions, signal });
          signal?.throwIfAborted();
          return { callId: call.callId, ok: true, result };
        } catch (error) {
          signal?.throwIfAborted();
          return actionFailure(call, error);
        }
      },
    };
  }
}

const primitive = (value: unknown) =>
  value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

/** A failure result. Details are a `VacpActionError`'s own details or a thrown primitive; nothing else is copied. */
export function actionFailure(call: VacpActionCall, error: unknown): Extract<VacpActionResult, { ok: false }> {
  const message = error instanceof Error ? error.message : String(error);
  const details = error instanceof VacpActionError ? error.details : primitive(error) ? error : undefined;
  return { callId: call.callId, ok: false, error: details === undefined ? { message } : { message, details } };
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
