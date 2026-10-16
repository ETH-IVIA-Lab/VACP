export function randomSuffix(length = 8): string {
  const raw =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random()}`;

  return raw.replaceAll(/[^a-zA-Z0-9]+/g, '').slice(0, length) || String(Date.now());
}

function sanitizeIdentifier(value: string): string {
  const cleaned = value
    .replaceAll(/[^a-zA-Z0-9_]+/g, '_')
    .replaceAll(/_+/g, '_')
    .replaceAll(/^_+|_+$/g, '');

  return cleaned || 'vacp';
}

/**
 * Create a unique DuckDB table name.
 *
 * The result is safe to use unquoted in SQL (letters/numbers/underscores only).
 */
export function makeVacpDuckDbTableName(args: { prefix: string; parts?: string[]; suffixLength?: number }): string {
  const base = [args.prefix, ...(args.parts ?? [])].filter(Boolean).join('_');
  const safe = sanitizeIdentifier(base);

  return `${safe}_${randomSuffix(args.suffixLength ?? 8)}`;
}
