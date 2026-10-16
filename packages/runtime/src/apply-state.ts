import type { VacpActionExecutionOptions } from '@vacp/protocol';
import { z } from 'zod';
import { vacpRefSchema } from '@vacp/protocol/validation';
import type { VacpActionDescriptor, VacpRef } from '@vacp/protocol';
import { VACP_APPLY_STATE_ACTION } from '@vacp/protocol';

import type { VacpActionRegistrar } from './action-registry';

export type VacpApplyStatePreparation<Result = unknown> = (
  state: Record<VacpRef, unknown>,
) =>
  | ((options: VacpActionExecutionOptions) => Result | Promise<Result>)
  | Promise<(options: VacpActionExecutionOptions) => Result | Promise<Result>>;

const paramsSchema = z.object({ state: z.record(vacpRefSchema, z.unknown()) });

/**
 * Register `vacp.apply_state`. `prepare` validates a desired state keyed by refs and returns the
 * closure that applies it. Replay restores any recorded state through it, including states in which
 * other nodes are unavailable, so the action declares no prerequisites.
 */
export function registerVacpApplyStateAction<Result>(
  registry: VacpActionRegistrar,
  prepare: VacpApplyStatePreparation<Result>,
  options?: { affects?: VacpRef[]; description?: string },
): VacpActionDescriptor {
  const descriptor: VacpActionDescriptor = {
    name: VACP_APPLY_STATE_ACTION,
    description:
      options?.description ??
      'Apply a desired VACP state map to the live app. The provider defines how refs are applied.',
    operation: {
      contract: VACP_APPLY_STATE_ACTION,
      kind: 'mutation',
      affects: options?.affects,
      results: [{ role: 'state', description: 'Updated analytical state' }],
    },
    parameters: {
      type: 'object',
      properties: {
        state: {
          type: 'object',
          description: 'Desired state keyed by vacp:// refs.',
        },
      },
      required: ['state'],
    },
  };

  return registry.register(
    descriptor,
    (params: { execute: Awaited<ReturnType<VacpApplyStatePreparation<Result>>>; refs: VacpRef[] }, executionOptions) =>
      params.execute(executionOptions),
    {
      parse: async (value) => {
        const { state } = paramsSchema.parse(value);
        const execute = await prepare(structuredClone(state));
        return { execute, refs: Object.keys(state) as VacpRef[] };
      },
      affects: (params) => params.refs,
    },
  );
}
