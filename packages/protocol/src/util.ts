import type { VacpActionDescriptor, VacpRef } from './schema';

export function isVacpRef(value: unknown): value is VacpRef {
  return typeof value === 'string' && value.startsWith('vacp://');
}

export function primaryOperationRef(action: VacpActionDescriptor): VacpRef | undefined {
  return action.operation.affects?.[0] ?? action.operation.inputRefs?.[0] ?? action.operation.results?.[0]?.ref;
}
