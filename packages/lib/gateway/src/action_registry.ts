import type { VacpActionCall, VacpActionDescriptor, VacpActionResult } from '@vacp/core';

export type VacpActionHandler = (params: unknown) => unknown | Promise<unknown>;

/**
 * Action registry (concepts).
 *
 * Providers register *semantic* actions here (e.g. "set_interval_2d") rather
 * than wiring agents to DOM events. This is the core of the VACP "control
 * plane".
 *
 * Actions should be a small, explicit set of validated operations the UI
 * intentionally exposes; not arbitrary code execution.
 */
export class VacpActionRegistry {
  private readonly descriptors = new Map<string, VacpActionDescriptor>();
  private readonly handlers = new Map<string, VacpActionHandler>();

  register(descriptor: VacpActionDescriptor, handler: VacpActionHandler): void {
    if (this.handlers.has(descriptor.name)) {
      throw new Error(
        `Duplicate action registration for "${descriptor.name}". Register each action name once (handlers should route via params).`,
      );
    }
    this.descriptors.set(descriptor.name, descriptor);
    this.handlers.set(descriptor.name, handler);
  }

  unregister(name: string): void {
    this.descriptors.delete(name);
    this.handlers.delete(name);
  }

  list(): VacpActionDescriptor[] {
    return Array.from(this.descriptors.values());
  }

  async execute(call: VacpActionCall): Promise<VacpActionResult> {
    const handler = this.handlers.get(call.name);
    if (!handler) {
      return { callId: call.callId, ok: false, error: { message: `Unknown action: ${call.name}` } };
    }
    try {
      const result = await handler(call.params);
      return { callId: call.callId, ok: true, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { callId: call.callId, ok: false, error: { message, details: error } };
    }
  }
}
