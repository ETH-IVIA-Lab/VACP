import { VACP_APPLY_STATE_ACTION, vacpHumanActor } from '@vacp/protocol';
import type {
  VacpActionExecutionOptions,
  VacpActionResult,
  VacpRef,
  VacpSourceId,
  VacpPageBridge,
} from '@vacp/protocol';
import { makeEntryId } from './runtime/helpers';

export type VacpRestorationOutcome = { sourceId: VacpSourceId; action: string; result: VacpActionResult };
export type VacpRestorationResult = VacpActionResult<
  { sources: VacpRestorationOutcome[] },
  { sources: VacpRestorationOutcome[] }
>;

type RestorationClient = Pick<VacpPageBridge, 'inspect' | 'execute'> & { readonly signal: AbortSignal };

/** Explicit host-owned restoration. Only requests made through this controller are serialized. */
export function createVacpRestorer(client: RestorationClient) {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    restore: (
      state: Record<VacpRef, unknown>,
      options: VacpActionExecutionOptions = {},
    ): Promise<VacpRestorationResult> => {
      const captured = structuredClone(state);
      const signal = AbortSignal.any([client.signal, ...(options.signal ? [options.signal] : [])]);
      const callId = makeEntryId();
      const run = async (): Promise<VacpRestorationResult> => {
        signal.throwIfAborted();
        try {
          const { graph } = await client.inspect();
          signal.throwIfAborted();
          const restorers = new Map<string, string>();
          for (const action of graph.actions) {
            if (action.operation.contract !== VACP_APPLY_STATE_ACTION) continue;
            const owner = graph.ownership.actions[action.name]!;
            const previous = restorers.get(owner);
            if (previous) throw new Error(`Source ${owner} has multiple state restorers: ${previous}, ${action.name}`);
            restorers.set(owner, action.name);
          }
          const grouped = new Map<string, Record<VacpRef, unknown>>();
          for (const [key, value] of Object.entries(captured)) {
            const ref = key as VacpRef;
            const owner = graph.ownership.nodes[ref];
            const name = owner && restorers.get(owner);
            if (!name) throw new Error(`No state restorer for ${ref}`);
            const values = grouped.get(name) ?? {};
            values[ref] = value;
            grouped.set(name, values);
          }
          // All ownership checks precede mutation. Wait for every source even when one fails.
          const calls = [...grouped].map(([name, values]) => ({
            callId: makeEntryId(),
            name,
            params: { state: values },
          }));
          const outcomes = await Promise.allSettled(
            calls.map((call) =>
              client.execute(call, {
                ...options,
                signal,
                actor: options.actor ?? vacpHumanActor,
                restoration: options.restoration ?? { id: callId },
              }),
            ),
          );
          signal.throwIfAborted();
          const sources = outcomes.map((outcome, index): VacpRestorationOutcome => {
            const call = calls[index]!;
            return {
              sourceId: graph.ownership.actions[call.name]!,
              action: call.name,
              result:
                outcome.status === 'fulfilled'
                  ? outcome.value
                  : { callId: call.callId, ok: false, error: { message: String(outcome.reason) } },
            };
          });
          const failures = sources.flatMap(({ result }) => (result.ok ? [] : [result.error.message]));
          return failures.length
            ? {
                callId,
                ok: false,
                error: { message: `State restoration failed: ${failures.join(', ')}`, details: { sources } },
              }
            : { callId, ok: true, result: { sources } };
        } catch (error) {
          signal.throwIfAborted();
          return { callId, ok: false, error: { message: error instanceof Error ? error.message : String(error) } };
        }
      };
      const result = tail.then(run, run);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
