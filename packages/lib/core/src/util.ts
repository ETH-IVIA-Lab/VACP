import type { VacpRef } from './schema';

export function isVacpRef(value: unknown): value is VacpRef {
  return typeof value === 'string' && value.startsWith('vacp://');
}

export function nowIso(): string {
  return new Date().toISOString();
}
