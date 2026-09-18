import type {
  VacpActionCall,
  VacpActionDescriptor,
  VacpActionResult,
  VacpActionExecutionOptions,
  VacpSourceId,
} from '@vacp/protocol';
import { fnv1a64Hex } from '@vacp/protocol';

export interface VacpActionExecutor {
  list(): VacpActionDescriptor[];
  execute(call: VacpActionCall, options?: VacpActionExecutionOptions): Promise<VacpActionResult>;
}

export interface VacpActionRegistrar {
  register<Result>(descriptor: VacpActionDescriptor, handler: VacpActionHandler<unknown, Result>): VacpActionDescriptor;
}

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
  private readonly handlers = new Map<string, VacpActionHandler>();

  constructor(private readonly sourceId?: VacpSourceId) {}

  register<Result>(
    descriptor: VacpActionDescriptor,
    handler: VacpActionHandler<unknown, Result>,
  ): VacpActionDescriptor {
    const registered = structuredClone(descriptor);
    if (this.sourceId) registered.name = qualifyVacpActionName(this.sourceId, descriptor.name);
    if (this.handlers.has(registered.name)) {
      throw new Error(
        `Duplicate action registration for "${descriptor.name}". Register each action name once (handlers should route via params).`,
      );
    }

    this.descriptors.set(registered.name, registered);
    this.handlers.set(registered.name, handler);
    return structuredClone(registered);
  }

  unregister(name: string): void {
    this.descriptors.delete(name);
    this.handlers.delete(name);
  }

  list(): VacpActionDescriptor[] {
    return structuredClone(Array.from(this.descriptors.values()));
  }

  async execute(call: VacpActionCall, options: VacpActionExecutionOptions = {}): Promise<VacpActionResult> {
    options.signal?.throwIfAborted();
    const handler = this.handlers.get(call.name);

    if (!handler) {
      return { callId: call.callId, ok: false, error: { message: `Unknown action: ${call.name}` } };
    }

    try {
      const result = await handler(call.params, options);

      return { callId: call.callId, ok: true, result: result === undefined ? undefined : result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      return { callId: call.callId, ok: false, error: { message, details: toSerializableErrorDetails(error) } };
    }
  }
}
