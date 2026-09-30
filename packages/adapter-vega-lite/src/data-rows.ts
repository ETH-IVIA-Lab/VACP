import { formatVacpWallClock, type VacpClock } from '@vacp/protocol';

import { vegaInstant } from './temporal';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeDuckDbValue(value: unknown) {
  if (value === undefined || value === null) return null;

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;

  if (typeof value === 'bigint') return value.toString();

  if (Array.isArray(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  if (typeof value === 'object') {
    // DuckDB cannot infer types from an empty JSON object (`{}`) and errors
    // with "STRUCT with no fields". Treat those as null.
    if (Object.keys(value as Record<string, unknown>).length === 0) return null;

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

/**
 * Rows ready for DuckDB, and the columns that hold instants with their clocks. A column holds
 * instants when the chart's dataflow says so or its values are Dates. Its instants load as
 * wall-clock text on the axis's clock, so SQL reads the dates the chart shows.
 */
export function tableRows(
  source: readonly unknown[],
  temporal: ReadonlyMap<string, VacpClock>,
): { rows: Record<string, unknown>[]; timestamps: Map<string, VacpClock> } {
  const timestamps = new Map<string, VacpClock>();
  const rows = source.flatMap((row) => {
    if (!isRecord(row)) return [];
    const entries = Object.entries(row).map(([key, value]) => {
      const clock = temporal.get(key) ?? (value instanceof Date ? 'local' : undefined);
      const instant = clock ? vegaInstant(value) : null;
      if (!clock || instant === null) return [key, sanitizeDuckDbValue(value)];
      timestamps.set(key, clock);
      return [key, formatVacpWallClock(instant, clock)];
    });
    return entries.length ? [Object.fromEntries(entries)] : [];
  });
  return { rows, timestamps };
}
