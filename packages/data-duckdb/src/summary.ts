import type { VacpDuckDbTableMetadata } from './metadata';

function fmtInt(n: number): string {
  try {
    return n.toLocaleString('en-US');
  } catch {
    return String(n);
  }
}

function fmtNum(n: number | null): string {
  if (n === null) return 'null';

  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;

  return n.toFixed(digits);
}

function fmtIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  // Prefer YYYY-MM-DD when possible to keep summaries compact.
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T/);

  return m ? m[1]! : iso;
}

function limitText(text: string, max = 160): string {
  if (text.length <= max) return text;

  return `${text.slice(0, Math.max(0, max - 1))}...`;
}

export function formatDuckDbTableMetadataSummary(
  meta: VacpDuckDbTableMetadata,
  options?: { maxColumns?: number; maxNumeric?: number; maxCategorical?: number },
): string {
  const maxColumns = options?.maxColumns ?? 8;
  const maxNumeric = options?.maxNumeric ?? 3;
  const maxCategorical = options?.maxCategorical ?? 2;

  const lines: string[] = [];
  const rowCount = typeof meta.rowCount === 'number' ? meta.rowCount : null;
  const rows = rowCount !== null ? fmtInt(rowCount) : 'unknown';
  lines.push(`Rows: ${rows} · Columns: ${meta.columns.length}`);

  if (typeof meta.sampledRows === 'number' && Number.isFinite(meta.sampledRows)) {
    const requestedSampledRows = Math.max(0, Math.floor(meta.sampledRows));

    if (requestedSampledRows > 0) {
      const effectiveSampledRows = rowCount !== null ? Math.min(requestedSampledRows, rowCount) : requestedSampledRows;
      lines[0] += ` · Sampled: ${fmtInt(effectiveSampledRows)}`;
    }
  }

  if (meta.columns.length) {
    const cols = meta.columns
      .slice(0, maxColumns)
      .map((c) => `${c.name}:${c.type}`)
      .join(', ');

    const extra = meta.columns.length > maxColumns ? ` (+${meta.columns.length - maxColumns} more)` : '';
    lines.push(limitText(`Schema: ${cols}${extra}`, 220));
  }

  const numericKeys = meta.numeric ? Object.keys(meta.numeric) : [];

  if (numericKeys.length) {
    const parts = numericKeys.slice(0, maxNumeric).map((k) => {
      const s = meta.numeric?.[k];

      if (!s) return k;
      const minIso = fmtIso(s.minIso);
      const maxIso = fmtIso(s.maxIso);
      const isoRange = minIso && maxIso ? `${minIso}..${maxIso}` : null;
      const hint = s.unitHint ? ` (${s.unitHint})` : '';

      if (isoRange) return `${k}[${isoRange}]${hint}`;

      return `${k}[${fmtNum(s.min)}..${fmtNum(s.max)} avg ${fmtNum(s.avg)}]`;
    });

    const extra = numericKeys.length > maxNumeric ? ` (+${numericKeys.length - maxNumeric} more)` : '';
    lines.push(limitText(`Numeric: ${parts.join(', ')}${extra}`, 220));
  }

  const temporalKeys = meta.temporal ? Object.keys(meta.temporal) : [];

  if (temporalKeys.length) {
    const parts = temporalKeys.slice(0, maxNumeric).map((k) => {
      const s = meta.temporal?.[k];

      if (!s) return k;
      const minIso = fmtIso(s.minIso);
      const maxIso = fmtIso(s.maxIso);

      return `${k}[${minIso ?? 'null'}..${maxIso ?? 'null'}]`;
    });

    const extra = temporalKeys.length > maxNumeric ? ` (+${temporalKeys.length - maxNumeric} more)` : '';
    lines.push(limitText(`Temporal: ${parts.join(', ')}${extra}`, 220));
  }

  const catKeys = meta.categoricalTopValues ? Object.keys(meta.categoricalTopValues) : [];

  if (catKeys.length) {
    const cols = catKeys.slice(0, maxCategorical).map((k) => {
      const vals = meta.categoricalTopValues?.[k] ?? [];

      const top = vals
        .slice(0, 3)
        .map((v) => `${v.value}(${fmtInt(v.n)})`)
        .join(', ');

      return `${k}: ${top}`;
    });

    const extra = catKeys.length > maxCategorical ? ` (+${catKeys.length - maxCategorical} more)` : '';
    lines.push(limitText(`Top values: ${cols.join(' · ')}${extra}`, 220));
  }

  return lines.join('\n');
}
