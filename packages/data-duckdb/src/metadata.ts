import { sqlIdentifier, sqlStringLiteral } from './sql';
import type {
  VacpDataSchemaColumn,
  VacpDataSchemaDetail,
  VacpDataSchemaNumericSummary,
  VacpDataSchemaTable,
  VacpDataSchemaTemporalSummary,
} from '@ethivia/vacp-protocol';

import type { VacpDuckDbQueryClient } from './client';

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

  // TIMESTAMP without timezone, as wall-clock text: "YYYY-MM-DDTHH:MM:SS(.sss)" or with a space.
  if (/^\d{4}-\d{2}-\d{2}(?:T|\s+)\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) {
    const t = Date.parse(`${s.replace(/\s+/, 'T')}Z`);

    if (Number.isFinite(t)) return { iso: new Date(t).toISOString(), epochMs: t };
  }

  const t = Date.parse(s);

  if (Number.isFinite(t)) return { iso: new Date(t).toISOString(), epochMs: t };

  return null;
}

export async function describeDuckDbColumns(args: {
  duckdb: VacpDuckDbQueryClient;
  table: string;
}): Promise<VacpDataSchemaColumn[]> {
  const colsRaw = await args.duckdb.queryJson(`PRAGMA table_info(${sqlStringLiteral(sqlIdentifier(args.table))})`);

  // Constraints appear only where they hold, so an agent reading the schema pays for what it learns.
  const columns: VacpDataSchemaColumn[] = colsRaw.rows.flatMap((r) => {
    const name = typeof r.name === 'string' ? r.name : '';
    if (!name) return [];
    return [
      {
        name,
        type: typeof r.type === 'string' ? r.type : '',
        ...(r.notnull ? { notNull: true } : {}),
        ...(r.pk ? { primaryKey: true } : {}),
      },
    ];
  });

  return columns;
}

/**
 * `table`'s columns and row count, as `vacp.data_schema` reports them. `detail: 'full'` adds bounded
 * numeric, temporal, and top-category summaries over the first `sampleRows` rows, 25,000 by default,
 * or over every row when `sampleRows` is 0.
 */
export async function describeDuckDbTable(args: {
  duckdb: VacpDuckDbQueryClient;
  table: string;
  detail?: VacpDataSchemaDetail;
  sampleRows?: number;
}): Promise<VacpDataSchemaTable> {
  const tableSql = sqlIdentifier(args.table);

  const columns = await describeDuckDbColumns(args);

  const rowCountRes = await args.duckdb.queryJson(`SELECT COUNT(*)::BIGINT AS n FROM ${tableSql}`);
  const rowCount = parseNumber(rowCountRes.rows[0]?.n) ?? null;
  if (args.detail !== 'full') return { table: args.table, rowCount, columns };

  const sampleRows = args.sampleRows ?? 25_000;

  const sampleCte =
    sampleRows > 0 ? `WITH __vacp_sample AS (SELECT * FROM ${tableSql} LIMIT ${Math.floor(sampleRows)})` : '';

  const sampleFrom = sampleRows > 0 ? '__vacp_sample' : tableSql;

  const numericCols = columns.filter((c) => isNumericType(c.type)).slice(0, 8);
  const temporalCols = columns.filter((c) => isTemporalType(c.type)).slice(0, 6);
  const categoricalCols = columns.filter((c) => isTextType(c.type)).slice(0, 4);

  const numeric: Record<string, VacpDataSchemaNumericSummary> = {};

  if (numericCols.length) {
    const exprs = numericCols.flatMap((c, index) => {
      const col = sqlIdentifier(c.name);
      const base = `c${index}`;

      return [
        `MIN(${col})::DOUBLE AS ${sqlIdentifier(`${base}_min`)}`,
        `MAX(${col})::DOUBLE AS ${sqlIdentifier(`${base}_max`)}`,
        `AVG(${col})::DOUBLE AS ${sqlIdentifier(`${base}_avg`)}`,
      ];
    });

    const q = `${sampleCte} SELECT ${exprs.join(', ')} FROM ${sampleFrom}`;
    const res = await args.duckdb.queryJson(q);
    const row = res.rows[0] ?? {};

    for (const [index, c] of numericCols.entries()) {
      const base = `c${index}`;
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
        ...(sameUnit && hintMin && hintMax ? { unitHint: sameUnit, minIso: hintMin.iso, maxIso: hintMax.iso } : {}),
      };
    }
  }

  const temporal: Record<string, VacpDataSchemaTemporalSummary> = {};

  if (temporalCols.length) {
    const exprs = temporalCols.flatMap((c, index) => {
      const col = sqlIdentifier(c.name);
      const base = `c${index}`;

      return [`MIN(${col}) AS ${sqlIdentifier(`${base}_min`)}`, `MAX(${col}) AS ${sqlIdentifier(`${base}_max`)}`];
    });

    const q = `${sampleCte} SELECT ${exprs.join(', ')} FROM ${sampleFrom}`;
    const res = await args.duckdb.queryJson(q);
    const row = res.rows[0] ?? {};

    for (const [index, c] of temporalCols.entries()) {
      const base = `c${index}`;
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
    const col = sqlIdentifier(c.name);
    const q = `${sampleCte} SELECT ${col}::VARCHAR AS value, COUNT(*)::BIGINT AS n FROM ${sampleFrom} GROUP BY value ORDER BY n DESC LIMIT 5`;
    const res = await args.duckdb.queryJson(q);
    categoricalTopValues[c.name] = res.rows
      .map((r) => ({ value: typeof r.value === 'string' ? r.value : '', n: parseNumber(r.n) ?? 0 }))
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
