import { z } from 'zod';
import type { VacpActionDescriptor, VacpRef } from './schema.js';

export const vacpRefSchema = z.custom<VacpRef>(isVacpRef, 'Expected a vacp:// reference');

export function isVacpRef(value: unknown): value is VacpRef {
  return typeof value === 'string' && value.startsWith('vacp://');
}

export function splitVacpRefAt(ref: string, marker: string): { before: string; after: string } | null {
  const idx = ref.lastIndexOf(marker);

  if (idx < 0) return null;
  const before = ref.slice(0, idx);
  const after = ref.slice(idx + marker.length);

  if (!after) return null;

  return { before, after };
}

export function lastPathComponent(path: string): string | null {
  const parts = path.split('/').filter(Boolean);

  return parts.length ? parts[parts.length - 1]! : null;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function operationRefs(action: VacpActionDescriptor): VacpRef[] {
  return Array.from(
    new Set([
      ...(action.operation.inputRefs ?? []),
      ...(action.operation.affects ?? []),
      ...(action.operation.results ?? []).flatMap((result) => (result.ref ? [result.ref] : [])),
    ]),
  );
}

export function primaryOperationRef(action: VacpActionDescriptor): VacpRef | undefined {
  return action.operation.affects?.[0] ?? action.operation.inputRefs?.[0] ?? action.operation.results?.[0]?.ref;
}
