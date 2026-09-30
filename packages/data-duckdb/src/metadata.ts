import type { VacpDuckDbClient } from './client';

export type VacpDuckDbColumnInfo = {
  name: string;
  type: string;
  /** Present, and true, only for a NOT NULL column. */
  notNull?: true;
  /** Present, and true, only for a primary key column. */
  primaryKey?: true;
};

type VacpDuckDbNumericSummary = {
  min: number | null;
  max: number | null;
  avg: number | null;
  /**
   * Optional hint for numeric columns that look like epoch timestamps.
   * When set, `minIso`/`maxIso` provide human-readable bounds.
   */
  unitHint?: 'epoch_ms' | 'epoch_s' | null;
  minIso?: string | null;
  maxIso?: string | null;
};

type VacpDuckDbTemporalSummary = {
  minIso: string | null;
  maxIso: string | null;
  minEpochMs: number | null;
  maxEpochMs: number | null;
};

export type VacpDuckDbTableMetadata = {
  table: string;
  rowCount: number | null;
  columns: VacpDuckDbColumnInfo[];
  numeric?: Record<string, VacpDuckDbNumericSummary>;
  /** Date/time-like columns (DATE/TIMESTAMP/TIME) summarized for unit clarity. */
  temporal?: Record<string, VacpDuckDbTemporalSummary>;
  categoricalTopValues?: Record<string, Array<{ value: string; n: number }>>;
  sampledRows?: number | null;
};

function quoteIdent(part: string): string {
  return `"${part.replaceAll('"', '""')}"`;
}

function quoteTableRef(table: string): string {
  return table
    .split('.')
    .map((p) => quoteIdent(p))
    .join('.');
}

function isNumericType(type: string): boolean {
  const t = type.toUpperCase();

  return (
    t.includes('INT') ||
    t.includes('DOUBLE') ||
    t.includes('REAL') ||
    t.includes('FLOAT') ||
    t.includes('DECIMAL') ||
    t.includes('HUGEINT')
  );
}

function isTextType(type: string): boolean {
  const t = type.toUpperCase();

  return t.includes('VARCHAR') || t.includes('TEXT');
}

function isTemporalType(type: string): boolean {
  const t = type.toUpperCase();

  return t.includes('DATE') || t.includes('TIME') || t.includes('TIMESTAMP');
}

function parseNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;

  return Number.isFinite(n) ? n : null;
}

function parseEpochHint(value: number): { unit: 'epoch_ms' | 'epoch_s'; iso: string } | null {
  // Heuristics:
  // - seconds: ~1e9..1e10 (2001..2286)
  // - millis:  ~1e11..1e14 (1973..5138)
  const abs = Math.abs(value);

  if (abs >= 1e11 && abs <= 1e14) {
    return { unit: 'epoch_ms', iso: new Date(value).toISOString() };
  }

  if (abs >= 1e9 && abs < 1e11) {
    return { unit: 'epoch_s', iso: new Date(value * 1000).toISOString() };
  }

  return null;
}

function parseTemporalValue(value: unknown): { iso: string; epochMs: number } | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return { iso: value.toISOString(), epochMs: value.getTime() };
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const hint = parseEpochHint(value);

    if (hint) {
      const epochMs = hint.unit === 'epoch_ms' ? value : value * 1000;

      return { iso: hint.iso, epochMs };
    }

    return null;
  }

  if (typeof value !== 'string') return null;
  const s = value.trim();

  if (!s) return null;

  // DATE: "YYYY-MM-DD"
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const t = Date.parse(`${s}T00:00:00Z`);

    if (Number.isFinite(t)) return { iso: new Date(t).toISOString(), epochMs: t };
  }

  // TIMESTAMP without timezone: "YYYY-MM-DD HH:MM:SS(.sss)"
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) {
    const t = Date.parse(`${s.replace(' ', 'T')}Z`);

    if (Number.isFinite(t)) return { iso: new Date(t).toISOString(), epochMs: t };
  }

  const t = Date.parse(s);

  if (Number.isFinite(t)) return { iso: new Date(t).toISOString(), epochMs: t };

  return null;
}

/**
 * Lightweight DuckDB table metadata intended for agent context.
 *
 * Defaults are tuned for "fast enough" even on medium datasets:
 * - schema + row count are always returned
 * - summaries are computed on a bounded sample (LIMIT) unless `sampleRows=0`
 */
export async function getDuckDbTableMetadata(args: {
  duckdb: VacpDuckDbClient;
  table: string;
  sampleRows?: number;
  maxNumericColumns?: number;
  maxTemporalColumns?: number;
  maxCategoricalColumns?: number;
  topK?: number;
}): Promise<VacpDuckDbTableMetadata> {
  const sampleRows = args.sampleRows ?? 25_000;
  const maxNumericColumns = args.maxNumericColumns ?? 8;
  const maxTemporalColumns = args.maxTemporalColumns ?? 6;
  const maxCategoricalColumns = args.maxCategoricalColumns ?? 4;
  const topK = args.topK ?? 5;

  const tableSql = quoteTableRef(args.table);

  const colsRaw = await args.duckdb.queryJson(`PRAGMA table_info('${args.table.replaceAll("'", "''")}')`);

  // Constraints appear only where they hold, so an agent reading the schema pays for what it learns.
  const columns: VacpDuckDbColumnInfo[] = colsRaw.rows.flatMap((r) => {
    const name = typeof r.name === 'string' ? r.name : String(r.name ?? '');
    if (!name) return [];
    return [
      {
        name,
        type: typeof r.type === 'string' ? r.type : String(r.type ?? ''),
        ...(r.notnull ? { notNull: true } : {}),
        ...(r.pk ? { primaryKey: true } : {}),
      },
    ];
  });

  const rowCountRes = await args.duckdb.queryJson(`SELECT COUNT(*)::BIGINT AS n FROM ${tableSql}`);
  const rowCount = parseNumber(rowCountRes.rows[0]?.n) ?? null;

  const sampleCte =
    sampleRows > 0 ? `WITH __vacp_sample AS (SELECT * FROM ${tableSql} LIMIT ${Math.floor(sampleRows)})` : '';

  const sampleFrom = sampleRows > 0 ? '__vacp_sample' : tableSql;

  const numericCols = columns.filter((c) => isNumericType(c.type)).slice(0, maxNumericColumns);
  const temporalCols = columns.filter((c) => isTemporalType(c.type)).slice(0, maxTemporalColumns);
  const categoricalCols = columns.filter((c) => isTextType(c.type)).slice(0, maxCategoricalColumns);

  const numeric: Record<string, VacpDuckDbNumericSummary> = {};

  if (numericCols.length) {
    const exprs = numericCols.flatMap((c) => {
      const col = quoteIdent(c.name);
      const base = c.name.replaceAll(/[^a-zA-Z0-9_]+/g, '_');

      return [
        `MIN(${col})::DOUBLE AS ${quoteIdent(`${base}_min`)}`,
        `MAX(${col})::DOUBLE AS ${quoteIdent(`${base}_max`)}`,
        `AVG(${col})::DOUBLE AS ${quoteIdent(`${base}_avg`)}`,
      ];
    });

    const q = `${sampleCte} SELECT ${exprs.join(', ')} FROM ${sampleFrom}`;
    const res = await args.duckdb.queryJson(q);
    const row = res.rows[0] ?? {};

    for (const c of numericCols) {
      const base = c.name.replaceAll(/[^a-zA-Z0-9_]+/g, '_');
      const min = parseNumber(row[`${base}_min`]);
      const max = parseNumber(row[`${base}_max`]);
      const avg = parseNumber(row[`${base}_avg`]);
      const hintMin = min === null ? null : parseEpochHint(min);
      const hintMax = max === null ? null : parseEpochHint(max);
      const sameUnit = hintMin && hintMax && hintMin.unit === hintMax.unit ? hintMin.unit : null;
      numeric[c.name] = {
        min,
        max,
        avg,
        unitHint: sameUnit,
        minIso: sameUnit && hintMin ? hintMin.iso : null,
        maxIso: sameUnit && hintMax ? hintMax.iso : null,
      };
    }
  }

  const temporal: Record<string, VacpDuckDbTemporalSummary> = {};

  if (temporalCols.length) {
    const exprs = temporalCols.flatMap((c) => {
      const col = quoteIdent(c.name);
      const base = c.name.replaceAll(/[^a-zA-Z0-9_]+/g, '_');

      return [`MIN(${col}) AS ${quoteIdent(`${base}_min`)}`, `MAX(${col}) AS ${quoteIdent(`${base}_max`)}`];
    });

    const q = `${sampleCte} SELECT ${exprs.join(', ')} FROM ${sampleFrom}`;
    const res = await args.duckdb.queryJson(q);
    const row = res.rows[0] ?? {};

    for (const c of temporalCols) {
      const base = c.name.replaceAll(/[^a-zA-Z0-9_]+/g, '_');
      const minV = parseTemporalValue(row[`${base}_min`]);
      const maxV = parseTemporalValue(row[`${base}_max`]);
      temporal[c.name] = {
        minIso: minV?.iso ?? null,
        maxIso: maxV?.iso ?? null,
        minEpochMs: minV?.epochMs ?? null,
        maxEpochMs: maxV?.epochMs ?? null,
      };
    }
  }

  const categoricalTopValues: Record<string, Array<{ value: string; n: number }>> = {};

  for (const c of categoricalCols) {
    const col = quoteIdent(c.name);
    const q = `${sampleCte} SELECT ${col}::VARCHAR AS value, COUNT(*)::BIGINT AS n FROM ${sampleFrom} GROUP BY value ORDER BY n DESC LIMIT ${Math.floor(topK)}`;
    const res = await args.duckdb.queryJson(q);
    categoricalTopValues[c.name] = res.rows
      .map((r) => ({ value: String(r.value ?? ''), n: parseNumber(r.n) ?? 0 }))
      .filter((r) => r.value);
  }

  return {
    table: args.table,
    rowCount,
    columns,
    numeric: Object.keys(numeric).length ? numeric : undefined,
    temporal: Object.keys(temporal).length ? temporal : undefined,
    categoricalTopValues: Object.keys(categoricalTopValues).length ? categoricalTopValues : undefined,
    sampledRows: sampleRows > 0 ? sampleRows : null,
  };
}
