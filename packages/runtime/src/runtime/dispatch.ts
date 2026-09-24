import {
  assertVacpActionAvailable,
  nowIso,
  parseVacpNarration,
  type VacpActionCall,
  type VacpActionExecutionOptions,
  type VacpActionResult,
  type VacpExecution,
  type VacpObservation,
  type VacpProvenanceRecord,
  type VacpProvider,
  type VacpTerminalExecution,
} from '@vacp/protocol';
import { actionFailure } from '../action-registry';
import type { createAgentActivityChannel } from './activities';
import type { createExecutionChannel } from './executions';
import type { createLiveObservations } from './observations';
import { entryActor, makeEntryId } from './helpers';

/** Execution has one terminal outcome. Recording and presentation cannot replace it. */
export function createDispatcher(args: {
  lifetime: AbortSignal;
  providers: ReadonlyMap<string, VacpProvider>;
  getProviderBinding(provider: VacpProvider): { id: string; signal: AbortSignal };
  getEpoch(): number;
  observations: ReturnType<typeof createLiveObservations>;
  executions: ReturnType<typeof createExecutionChannel>;
  agentActivities: ReturnType<typeof createAgentActivityChannel>;
  record(record: VacpProvenanceRecord): void;
  acknowledge(observation: VacpObservation): void;
  actionStarted(execution: VacpExecution): void;
  actionFinished(id: string): void;
}) {
  let sequence = 0;
  return async (inputCall: VacpActionCall, options?: VacpActionExecutionOptions): Promise<VacpActionResult> => {
    const call = structuredClone(inputCall);
    const requestedProviders = new Map(args.providers);
    const epoch = args.getEpoch();
    const actor = entryActor(options?.actor);
    const step = args.agentActivities.beginStep(
      actor.id,
      options?.narration === undefined ? undefined : parseVacpNarration(options.narration),
    );
    let signal = AbortSignal.any([args.lifetime, ...(options?.signal ? [options.signal] : [])]);
    const execution: VacpExecution = {
      id: makeEntryId(),
      sequence: ++sequence,
      callId: call.callId,
      name: call.name,
      actor,
      activityId: step.activityId,
      narration: step.narration,
      restoration: options?.restoration ? structuredClone(options.restoration) : undefined,
      phase: 'accepted',
      at: nowIso(),
    };
    let terminal: VacpTerminalExecution | undefined;
    const emit = (phase: VacpExecution['phase'], detail?: string) => {
      if (terminal) return;
      Object.assign(execution, { phase, at: nowIso(), message: detail });
      if (phase === 'succeeded' || phase === 'failed' || phase === 'cancelled') {
        terminal = { ...execution, phase };
      }
      args.executions.emit(execution);
    };
    let before: VacpObservation | undefined;
    let result: VacpActionResult;
    let cancellation: { reason: unknown } | undefined;
    let applying = false;
    emit('accepted');
    try {
      try {
        signal.throwIfAborted();
        const resolved = await args.observations.read();
        assertVacpActionAvailable(resolved, call);
        const initial = resolved.inspection;
        const owner = initial.graph.ownership.actions[call.name];
        const provider = owner ? args.providers.get(owner) : undefined;
        if (!provider) throw new Error(`Unknown action: ${call.name}`);
        if (requestedProviders.get(owner) !== provider) throw new DOMException('Provider replaced', 'AbortError');
        const binding = args.getProviderBinding(provider);
        signal = AbortSignal.any([signal, binding.signal]);
        signal.throwIfAborted();
        execution.sourceId = owner;
        execution.bindingId = binding.id;
        const descriptor = initial.graph.actions.find((action) => action.name === call.name);
        execution.title = descriptor?.title;
        execution.operationKind = descriptor?.operation.kind;
        const prepared = await provider.prepare(call, { ...options, signal });
        signal.throwIfAborted();
        execution.intent = structuredClone(prepared.intent);
        emit('prepared');
        await args.executions.present(execution, signal);
        signal.throwIfAborted();
        const current = await args.observations.read();
        signal.throwIfAborted();
        assertVacpActionAvailable(current, call);
        // Composition already isolated this observation from every native provider.
        before = current.inspection;
        applying = true;
        args.actionStarted(execution);
        emit('running');
        result = await prepared.execute({ ...options, signal });
        // The provider returned an outcome: later cancellation belongs to presentation only.
        emit(result.ok ? 'succeeded' : 'failed', result.ok ? undefined : result.error.message);
      } catch (error) {
        result = actionFailure(call, error);
        if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
          cancellation = { reason: error };
          emit('cancelled', 'Execution cancelled; changes already applied are not rolled back');
        } else emit('failed', result.error.message);
      }
      args.observations.invalidate();
      const after = args.lifetime.aborted
        ? undefined
        : await args.observations.read().then(
            (value) => value.inspection,
            () => undefined,
          );
      if (!args.lifetime.aborted && epoch === args.getEpoch() && terminal) {
        if (after) args.acknowledge(after);
        args.record({
          id: makeEntryId(),
          at: nowIso(),
          kind: 'action',
          execution: terminal,
          call,
          result,
          before,
          observation: after,
        });
      }
      if (applying) {
        applying = false;
        args.actionFinished(execution.id);
      }
      if (cancellation) throw cancellation.reason;
      await args.executions.present(execution, signal, 'after');
      return result;
    } finally {
      if (applying) args.actionFinished(execution.id);
    }
  };
}
