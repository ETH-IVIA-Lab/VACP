import type { VacpActionExecutionOptions } from '@vacp/protocol';
import { z } from 'zod';
import { vacpRefSchema } from '@vacp/protocol';
import type { VacpActionDescriptor, VacpRef } from '@vacp/protocol';
import { VACP_APPLY_STATE_ACTION } from '@vacp/protocol';

import type { VacpActionRegistrar } from './action-registry.js';

export type VacpApplyStateHandler<Result = unknown> = (
  state: Record<VacpRef, unknown>,
  options: VacpActionExecutionOptions,
) => Result | Promise<Result>;

const paramsSchema = z.object({ state: z.record(vacpRefSchema, z.unknown()) });

/**
 * Register the standard action `vacp.apply_state`.
 *
 * This action lets a caller submit a JSON "desired state" map keyed by VACP
 * refs. The provider decides how to interpret and apply these values to the
 * live app (usually by translating them into more precise semantic actions).
 */
export function registerVacpApplyStateAction<Result>(
  registry: VacpActionRegistrar,
  handler: VacpApplyStateHandler<Result>,
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

  return registry.register(descriptor, (params, executionOptions) => {
    const parsed = paramsSchema.parse(params);

    return handler(parsed.state, executionOptions);
  });
}
