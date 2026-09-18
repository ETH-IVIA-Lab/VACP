import { z } from 'zod';
import type { VacpRef } from './schema';

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
