import type { VacpRef, VacpActionExecutionOptions } from '@vacp/protocol';
import type { VgplotBindings } from './bindings';
import type { createVgplotOperations, VgplotOperation } from './operations';

/** Validate the entire supported restoration before executing any mutation. Read-only refs are reported. */
export function prepareVgplotRestoration(
  bindings: VgplotBindings,
  operations: ReturnType<typeof createVgplotOperations>,
  state: Record<VacpRef, unknown>,
) {
  const skipped: Array<{ ref: string; reason: string }> = [];
  const plans: Array<{ ref: string; operations: VgplotOperation[] }> = [];
  for (const [ref, value] of Object.entries(state)) {
    const binding = bindings.byRef.get(ref as VacpRef);
    const operationsForRef = binding ? operations.restore(binding, value) : null;
    if (operationsForRef) plans.push({ ref, operations: operationsForRef });
    else skipped.push({ ref, reason: 'Read-only or transient state has no restoration operation' });
  }
  return async (options: VacpActionExecutionOptions) => {
    const errors: Array<{ ref: string; message: string }> = [];
    let applied = 0;
    for (const plan of plans) {
      options.signal?.throwIfAborted();
      try {
        for (const operation of plan.operations) {
          options.signal?.throwIfAborted();
          await operation.execute();
        }
        applied++;
      } catch (error) {
        options.signal?.throwIfAborted();
        errors.push({ ref: plan.ref, message: error instanceof Error ? error.message : String(error) });
      }
    }
    if (errors.length)
      throw new AggregateError(
        errors.map(({ ref, message }) => new Error(`${ref}: ${message}`)),
        `State restoration applied ${applied} refs; failed: ${errors.map(({ ref, message }) => `${ref}: ${message}`).join('; ')}`,
      );
    return { applied, skipped };
  };
}
