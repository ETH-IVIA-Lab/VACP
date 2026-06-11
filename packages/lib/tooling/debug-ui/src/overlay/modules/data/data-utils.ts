import type { VacpRef } from '@vacp/core';
import type { SqlResultColumn } from '@vacp/debug-ui/ui/sql/types';
import type { DebugSqlColumn, DebugSqlSchema } from './use-sql-namespace';

export type DataQueryTemplateId =
  | 'count'
  | 'sample'
  | 'selected-vs-all'
  | 'group-categorical'
  | 'numeric-summary'
  | 'temporal-range';

export type DataQueryTemplate = {
  id: DataQueryTemplateId;
  label: string;
  description: string;
  sql: string | null;
  disabledReason?: string;
};

export function defaultQuery(): string {
  return [
    'SELECT',
    '  COUNT(*)::INTEGER AS n_selected,',
    '  (SELECT COUNT(*)::INTEGER FROM vacp_all) AS n_all',
    'FROM vacp_handle;',
  ].join('\n');
}

export function shortRef(ref: VacpRef): string {
  const s = String(ref);
  const hashIdx = s.indexOf('#');
  const clean = hashIdx >= 0 ? s.slice(0, hashIdx) : s;
  const parts = clean
    .split('/')
    .filter(Boolean)
    .filter((p) => p !== 'vacp:');
  return parts.slice(-3).join('/');
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function isNumericColumn(column: DebugSqlColumn): boolean {
  const t = column.type.toUpperCase();
  return (
    t.includes('INT') ||
    t.includes('DOUBLE') ||
    t.includes('REAL') ||
    t.includes('FLOAT') ||
    t.includes('DECIMAL') ||
    t.includes('NUMERIC') ||
    t.includes('HUGEINT')
  );
}

function isTemporalColumn(column: DebugSqlColumn): boolean {
  const t = column.type.toUpperCase();
  return t.includes('DATE') || t.includes('TIME') || t.includes('TIMESTAMP');
}

function isCategoricalColumn(column: DebugSqlColumn): boolean {
  const t = column.type.toUpperCase();
  return (
    t.includes('VARCHAR') ||
    t.includes('TEXT') ||
    t.includes('CHAR') ||
    t.includes('ENUM') ||
    t.includes('BOOLEAN') ||
    t === 'BOOL'
  );
}

function firstColumn(columns: DebugSqlColumn[], predicate: (column: DebugSqlColumn) => boolean): DebugSqlColumn | null {
  return columns.find(predicate) ?? null;
}

function template(
  id: DataQueryTemplateId,
  label: string,
  description: string,
  sql: string | null,
  disabledReason?: string,
): DataQueryTemplate {
  return { id, label, description, sql, disabledReason };
}

export function buildDataQueryTemplates(schema: DebugSqlSchema): DataQueryTemplate[] {
  const columns = schema.vacp_all.length ? schema.vacp_all : schema.vacp_handle;
  const categorical = firstColumn(columns, isCategoricalColumn) ?? columns[0] ?? null;
  const numeric = firstColumn(columns, isNumericColumn);
  const temporal = firstColumn(columns, isTemporalColumn);

  const categoricalSql = categorical
    ? [
        `SELECT ${quoteIdent(categorical.name)} AS category,`,
        '  COUNT(*)::INTEGER AS n',
        'FROM vacp_handle',
        'GROUP BY 1',
        'ORDER BY n DESC',
        'LIMIT 25;',
      ].join('\n')
    : null;

  const numericSql = numeric
    ? [
        'SELECT',
        `  MIN(${quoteIdent(numeric.name)}) AS min_value,`,
        `  AVG(${quoteIdent(numeric.name)}) AS avg_value,`,
        `  MAX(${quoteIdent(numeric.name)}) AS max_value,`,
        `  STDDEV_SAMP(${quoteIdent(numeric.name)}) AS stddev_value,`,
        `  COUNT(${quoteIdent(numeric.name)})::INTEGER AS n_non_null`,
        'FROM vacp_handle;',
      ].join('\n')
    : null;

  const temporalSql = temporal
    ? [
        'SELECT',
        `  MIN(${quoteIdent(temporal.name)}) AS min_time,`,
        `  MAX(${quoteIdent(temporal.name)}) AS max_time,`,
        '  COUNT(*)::INTEGER AS n',
        'FROM vacp_handle',
        `WHERE ${quoteIdent(temporal.name)} IS NOT NULL;`,
      ].join('\n')
    : null;

  return [
    template('count', 'Count', 'Count selected rows and all rows.', defaultQuery()),
    template('sample', 'Sample rows', 'Preview the first rows from the selected handle.', 'SELECT *\nFROM vacp_handle\nLIMIT 25;'),
    template(
      'selected-vs-all',
      'Selected vs all',
      'Calculate selected rows, all rows, and selected percentage.',
      [
        'SELECT',
        '  COUNT(*)::INTEGER AS n_selected,',
        '  (SELECT COUNT(*)::INTEGER FROM vacp_all) AS n_all,',
        '  ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM vacp_all), 0), 2) AS pct_selected',
        'FROM vacp_handle;',
      ].join('\n'),
    ),
    template(
      'group-categorical',
      categorical ? `Group ${categorical.name}` : 'Group category',
      categorical ? `Count rows by ${categorical.name}.` : 'Count rows by a categorical column.',
      categoricalSql,
      categorical ? undefined : 'No columns are available yet.',
    ),
    template(
      'numeric-summary',
      numeric ? `Summarize ${numeric.name}` : 'Numeric summary',
      numeric ? `Compute min, average, max, and sample standard deviation for ${numeric.name}.` : 'Summarize a numeric column.',
      numericSql,
      numeric ? undefined : 'No numeric column found in schema.',
    ),
    template(
      'temporal-range',
      temporal ? `Range ${temporal.name}` : 'Temporal range',
      temporal ? `Find the observed time range for ${temporal.name}.` : 'Find the observed range for a date or time column.',
      temporalSql,
      temporal ? undefined : 'No date or time column found in schema.',
    ),
  ];
}

function csvCell(value: unknown): string {
  if (value == null) return '';
  const safe = toExportJsonSafe(value);
  const rawText = typeof safe === 'object' ? JSON.stringify(safe) : String(safe);
  const text = /^[\t\r\n ]*[=+\-@]/.test(rawText) ? `'${rawText}` : rawText;
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function toExportJsonSafe(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (depth >= 8) return '[truncated]';
  if (Array.isArray(value)) return value.map((item) => toExportJsonSafe(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = toExportJsonSafe(child, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function resultRowsToCsv(columns: readonly SqlResultColumn[], rows: readonly Record<string, unknown>[]): string {
  const names = columns.map((c) => c.name);
  const lines = [names.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(names.map((name) => csvCell(row[name])).join(','));
  }
  return lines.join('\n');
}

export function resultRowsToJson(args: {
  columns: readonly SqlResultColumn[];
  rows: readonly Record<string, unknown>[];
  resolvedSql: string;
  selectedHandle: VacpRef | null;
}): string {
  return JSON.stringify(
    {
      selectedHandle: args.selectedHandle,
      resolvedSql: args.resolvedSql,
      columns: args.columns.map((c) => ({ name: c.name, type: c.databaseType })),
      rows: args.rows.map((row) => toExportJsonSafe(row)),
    },
    null,
    2,
  );
}

export function safeDataExportName(label: string, extension: string): string {
  const stem = label
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${stem || 'vacp-data'}.${extension}`;
}

export function downloadTextFile(filename: string, text: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
