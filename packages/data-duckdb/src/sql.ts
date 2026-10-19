import { formatVacpWallClock, type VacpClock } from '@ethivia/vacp-protocol';

function stripTrailingSemicolons(sql: string): string {
  let out = sql.trim();

  while (out.endsWith(';')) out = out.slice(0, -1).trim();

  return out;
}

function hasMultipleStatements(sql: string): boolean {
  // Extremely small guardrail: detect `;` outside single/double quotes.
  // This is not a full SQL parser, but blocks the most common "multi statement"
  // inputs while allowing normal strings.
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (ch === "'" && !inDouble) {
      const next = sql[i + 1];

      if (inSingle && next === "'") {
        i += 1;
        continue;
      }

      inSingle = !inSingle;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (ch === ';' && !inSingle && !inDouble) return true;
  }

  return false;
}

export function normalizeSingleStatementSql(sql: string): string {
  const trimmed = stripTrailingSemicolons(sql);

  if (!trimmed) throw new Error('SQL must be a non-empty string');

  if (hasMultipleStatements(trimmed)) throw new Error('SQL must be a single statement (no unquoted semicolons)');

  return trimmed;
}

/** Escape a string for use as a SQL single-quoted literal. */
export function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Escape an identifier for use in SQL (double-quoted).
 *
 * This handles reserved words (e.g. `"group"`) and special characters.
 */
export function sqlIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** An instant as a TIMESTAMP literal, holding its wall-clock time on `clock`. */
export function sqlTimestampLiteral(time: number, clock: VacpClock): string {
  return `TIMESTAMP '${formatVacpWallClock(time, clock).replace('T', ' ')}'`;
}
