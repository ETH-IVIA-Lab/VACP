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
  const activeSources: string[] = [];
  const clearActive: Array<{ ref: string; execute: () => Promise<void> }> = [];
  for (const [ref, value] of Object.entries(state)) {
    const group = bindings.selections.find((group) => group.ref === ref);
    if (group) {
      if (!value || typeof value !== 'object' || !('activeSource' in value) || value.activeSource === undefined) {
        skipped.push({ ref, reason: 'Active native source is not represented by this provider' });
        continue;
      }
      const source = value.activeSource;
      if (source === null) {
        const update = group.selection.update;
        if (!update) throw new Error('Selection has no native update operation');
        clearActive.push({
          ref,
          execute: async () => {
            update.call(group.selection, { source: null, value: null, predicate: null });
            await group.selection.pending?.('value');
          },
        });
      } else if (typeof source === 'string' && group.sources.has(source as VacpRef)) activeSources.push(source);
      else throw new Error(`Unknown active selection source: ${String(source)}`);
      continue;
    }
    const binding = bindings.byRef.get(ref as VacpRef);
    const operationsForRef = binding ? operations.restore(binding, value) : null;
    if (operationsForRef) plans.push({ ref, operations: operationsForRef });
    else skipped.push({ ref, reason: 'Read-only or transient state has no restoration operation' });
  }
  // Restore values first, then publish each shared selection's original active source last.
  for (const ref of activeSources) {
    const index = plans.findIndex((plan) => plan.ref === ref);
    if (index < 0) throw new Error(`Active selection source requires restorable state: ${ref}`);
    plans.push(...plans.splice(index, 1));
  }
  for (const { ref, execute } of clearActive)
    plans.push({ ref, operations: [{ focus: { ref: ref as VacpRef }, execute }] });
  return async (options: VacpActionExecutionOptions) => {
    const errors: Array<{ ref: string; message: string }> = [];
    let applied = 0;
    for (const plan of plans) {
      options.signal?.throwIfAborted();
      try {
        for (const operation of plan.operations) {
          options.signal?.throwIfAborted();
          await operation.execute(options);
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
