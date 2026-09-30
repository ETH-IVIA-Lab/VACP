import { formatVacpWallClock, type VacpClock } from '@vacp/protocol';

import type { VegaLiteDataflow } from './dataflow';
import { vegaInstant } from './temporal';

/** A value as Vega coerces it for a continuous scale, or null when it names no number. */
function number(value: unknown): number | null {
  const coerced = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof coerced === 'number' && Number.isFinite(coerced) ? coerced : null;
}

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
 * wall-clock text on the axis's clock, so SQL reads the dates the chart shows. A column a
 * continuous scale reads loads as numbers, as Vega coerces them. A value in either kind of column
 * that names no instant or number loads as null.
 */
export function tableRows(
  source: readonly unknown[],
  fields: Pick<VegaLiteDataflow, 'temporal' | 'numeric'>,
): { rows: Record<string, unknown>[]; timestamps: Map<string, VacpClock> } {
  const { temporal, numeric } = fields;
  const timestamps = new Map<string, VacpClock>();
  // Time units repeat a few hundred instants across every row, so each is formatted once per load.
  const texts = { local: new Map<number, string>(), utc: new Map<number, string>() };
  const wallClock = (time: number, clock: VacpClock) => {
    let text = texts[clock].get(time);
    if (text === undefined) texts[clock].set(time, (text = formatVacpWallClock(time, clock)));
    return text;
  };
  const rows: Record<string, unknown>[] = [];
  for (const row of source) {
    if (!isRecord(row)) continue;
    const keys = Object.keys(row);
    if (!keys.length) continue;
    const loaded: Record<string, unknown> = {};
    for (const key of keys) {
      const value = row[key];
      const clock = temporal.get(key) ?? (value instanceof Date ? 'local' : undefined);
      if (!clock) {
        loaded[key] = numeric.has(key) ? number(value) : sanitizeDuckDbValue(value);
        continue;
      }
      timestamps.set(key, clock);
      const instant = vegaInstant(value);
      loaded[key] = instant === null ? null : wallClock(instant, clock);
    }
    rows.push(loaded);
  }
  return { rows, timestamps };
}
