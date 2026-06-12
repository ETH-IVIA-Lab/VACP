import type { VacpActionDescriptor, VacpApplyStateParams, VacpRef } from '@vacp/core';
import { VACP_APPLY_STATE_ACTION } from '@vacp/core';

import { VacpActionRegistry } from './action-registry';

export type VacpApplyStateHandler = (state: Record<string, unknown>) => unknown | Promise<unknown>;

/**
 * Register the standard action `vacp.apply_state`.
 *
 * This action lets a caller submit a JSON "desired state" map keyed by VACP
 * refs. The provider decides how to interpret and apply these values to the
 * live app (usually by translating them into more precise semantic actions).
 */
export function registerVacpApplyStateAction(
  registry: VacpActionRegistry,
  handler: VacpApplyStateHandler,
  options?: { targetRef?: VacpRef; description?: string },
): VacpActionDescriptor {
  const descriptor: VacpActionDescriptor = {
    name: VACP_APPLY_STATE_ACTION,
    description:
      options?.description ??
      'Apply a desired VACP state map to the live app. The provider defines how refs are applied.',
    targetRef: options?.targetRef,
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

  registry.register(descriptor, async (params) => {
    const p = (params ?? {}) as Partial<VacpApplyStateParams> | null;
    const st = p && typeof p === 'object' ? (p as any).state : null;
    if (!st || typeof st !== 'object' || Array.isArray(st)) {
      throw new Error('Expected params.state to be an object keyed by vacp:// refs');
    }
    return handler(st as Record<string, unknown>);
  });

  return descriptor;
}
