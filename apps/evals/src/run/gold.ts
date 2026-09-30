import { DuckDBInstance } from '@duckdb/node-api';
import { join } from 'node:path';
import type { Scenario } from '../core/scenario';

function reader(path: string): string {
  const quoted = `'${path.replaceAll("'", "''")}'`;
  if (path.endsWith('.parquet')) return `read_parquet(${quoted})`;
  if (path.endsWith('.json')) return `read_json_auto(${quoted})`;
  return `read_csv_auto(${quoted})`;
}

/** Equal to the declared precision: `26.3` accepts 26.32 but not 26.4. */
function agrees(declared: unknown, actual: unknown): boolean {
  if (typeof declared === 'number') {
    const value = typeof actual === 'bigint' ? Number(actual) : Number(actual);
    const decimals = String(declared).split('.')[1]?.length ?? 0;
    return Math.abs(value - declared) <= 0.5 * 10 ** -decimals + 1e-9;
  }
  return String(actual) === String(declared);
}

export type GoldFinding = { scenario: string; sql: string; ok: boolean; detail: string };

/** Re-derive every declared gold row from the page's raw data, independently of VACP and of any model. */
export async function auditGold(repoRoot: string, scenarios: readonly Scenario[]): Promise<GoldFinding[]> {
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  const findings: GoldFinding[] = [];
  try {
    for (const scenario of scenarios) {
      for (const gold of scenario.gold) {
        const sql = gold.sql.replace(/\{(\w+)\}/g, (_, key: string) => {
          const file = scenario.page.data?.[key];
          if (!file) throw new Error(`${scenario.id}: page ${scenario.page.id} has no data file "${key}"`);
          return reader(join(repoRoot, file));
        });
        try {
          const rows = (await (await connection.runAndReadAll(sql)).getRowObjectsJS()) as Record<string, unknown>[];
          const row = rows[0] ?? {};
          const wrong = Object.entries(gold.row).filter(([key, value]) => !agrees(value, row[key]));
          findings.push({
            scenario: scenario.id,
            sql: gold.sql,
            ok: wrong.length === 0,
            detail: wrong.length
              ? wrong
                  .map(([key, value]) => `${key}: declared ${JSON.stringify(value)}, data ${String(row[key])}`)
                  .join('; ')
              : JSON.stringify(gold.row),
          });
        } catch (error) {
          findings.push({ scenario: scenario.id, sql: gold.sql, ok: false, detail: (error as Error).message });
        }
      }
    }
  } finally {
    connection.closeSync();
  }
  return findings;
}
