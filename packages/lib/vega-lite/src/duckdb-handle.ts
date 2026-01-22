import type { VacpActionDescriptor, VacpRef } from '@vacp/core';
import type { VacpDuckDbClient, VacpDuckDbTableMetadata } from '@vacp/duckdb';
import {
  createDuckDbDataSqlHandler,
  createDuckDbWasmClient,
  getDuckDbTableMetadata,
  makeVacpDuckDbTableName,
} from '@vacp/duckdb';
import { registerVacpDataSqlAction, type VacpActionRegistry } from '@vacp/gateway';

import { whereClauseForCurrentSelections } from './duckdb-selection';
import { collectVegaLiteParams } from './params';
import { makeRef } from './refs';
import type { InstallVacpOnVegaLiteOptions, VegaLiteSpecLike, VegaViewLike } from './types';

export type VegaLiteDuckDbDataHandle = {
  ref: VacpRef;
  tableName: string;
  ensureMetadata: () => Promise<VacpDuckDbTableMetadata | null>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findEncodingField(spec: VegaLiteSpecLike, channel: string): string | null {
  const enc = spec.encoding;
  const field = enc && isRecord(enc) ? (enc[channel] as unknown) : null;
  if (field && isRecord(field) && typeof field.field === 'string') return field.field;

  const children: unknown[] = [];
  if (Array.isArray(spec.layer)) children.push(...spec.layer);
  if (Array.isArray(spec.hconcat)) children.push(...spec.hconcat);
  if (Array.isArray(spec.vconcat)) children.push(...spec.vconcat);
  if (Array.isArray(spec.concat)) children.push(...spec.concat);
  if (spec.spec) children.push(spec.spec);

  for (const child of children) {
    if (!child || typeof child !== 'object') continue;
    const f = findEncodingField(child as VegaLiteSpecLike, channel);
    if (f) return f;
  }
  return null;
}

function collectSelectionFields(spec: VegaLiteSpecLike): string[] {
  const fields = new Set<string>();
  for (const p of collectVegaLiteParams(spec)) {
    if (!p.select || !isRecord(p.select)) continue;
    const select = p.select;

    const selectFields = Array.isArray(select.fields) ? (select.fields as unknown[]) : [];
    for (const f of selectFields) {
      if (typeof f === 'string' && f) fields.add(f);
    }

    const encodings = Array.isArray(select.encodings) ? (select.encodings as unknown[]) : [];
    for (const ch of encodings) {
      if (typeof ch !== 'string' || !ch) continue;
      const f = findEncodingField(spec, ch);
      if (f) fields.add(f);
    }
  }
  return Array.from(fields);
}

function sanitizeDuckDbValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) {
    const t = value.getTime();
    if (Number.isFinite(t)) return value.toISOString();
    return null;
  }

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

function selectRowsFromView(spec: VegaLiteSpecLike, view: VegaViewLike): unknown[] | null {
  // If the spec embeds values inline, prefer them (stable + small).
  const inlineValues = spec.data && typeof spec.data === 'object' && Array.isArray((spec.data as any).values);
  const inlineRows = inlineValues ? ((spec.data as any).values as unknown[]) : null;
  if (inlineRows) return inlineRows;

  const requiredFields = collectSelectionFields(spec);

  // Best-effort: discover datasets via Vega's getState() API. By default Vega
  // only exports modified datasets; we override the predicate to include any
  // dataset with an array-like input.
  const state =
    typeof view.getState === 'function'
      ? view.getState({
          data: (name: string, data: unknown) => {
            if (String(name).startsWith('_:vega:_')) return false;
            const input = (data as any)?.input?.value as unknown;
            return Array.isArray(input);
          },
          signals: () => false,
          recurse: true,
        })
      : null;
  const stateData = isRecord(state) ? state.data : null;
  const dataMap = isRecord(stateData) ? stateData : null;

  const candidates: Array<{ name: string; rows: unknown[] }> = [];
  if (dataMap) {
    for (const [name, v] of Object.entries(dataMap)) {
      if (Array.isArray(v)) {
        candidates.push({ name, rows: v });
        continue;
      }
      if (isRecord(v) && Array.isArray((v as any).values)) {
        candidates.push({ name, rows: (v as any).values as unknown[] });
      }
    }
  }

  // Fallback: probe common Vega-Lite dataset names when getState isn't available.
  if (!candidates.length && typeof view.data === 'function') {
    const prefixes = ['source_', 'data_'];
    for (const prefix of prefixes) {
      for (let i = 0; i < 25; i += 1) {
        const name = `${prefix}${i}`;
        try {
          const rows = view.data(name);
          if (Array.isArray(rows)) candidates.push({ name, rows });
        } catch {
          // ignore
        }
      }
    }
  }

  const pickBest = (rows: unknown[]): Record<string, unknown> | null =>
    rows.find((r) => isRecord(r)) as Record<string, unknown> | null;

  const scoreCandidate = (c: { name: string; rows: unknown[] }): number => {
    const sample = pickBest(c.rows);
    if (!sample) return -1;

    let fieldMatches = 0;
    for (const f of requiredFields) if (f && Object.prototype.hasOwnProperty.call(sample, f)) fieldMatches += 1;

    let primitiveFields = 0;
    let nestedFields = 0;
    for (const v of Object.values(sample)) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') primitiveFields += 1;
      else nestedFields += 1;
    }

    const looksGeoJson = sample.type === 'Feature' && isRecord(sample.geometry);
    const hasGeometry = Object.prototype.hasOwnProperty.call(sample, 'geometry');
    const isStore = c.name.endsWith('_store') || c.name.includes('_store');

    const sizeScore = Math.log10(Math.max(1, c.rows.length));
    let score = 0;
    score += fieldMatches * 1000;
    score += primitiveFields * 10;
    score -= nestedFields * 50;
    score += sizeScore;
    if (looksGeoJson || hasGeometry) score -= 250;
    if (isStore) score -= 2_000;
    return score;
  };

  const scored = candidates
    .map((c) => ({ ...c, score: scoreCandidate(c) }))
    .filter((c) => c.score >= 0 && c.rows.length > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.rows ?? null;
}

/**
 * Optional DuckDB-backed DataHandle for Vega-Lite specs that embed inline data.
 *
 * This keeps DuckDB "first class" without requiring any additional data APIs:
 * - providers expose one semantic action: `vacp.data_sql`
 * - debug tools and transports can query selection state with SQL only
 */
export function installVegaLiteDuckDbDataHandle(args: {
  spec: VegaLiteSpecLike;
  view: VegaViewLike;
  options: InstallVacpOnVegaLiteOptions;
  actionRegistry: VacpActionRegistry;
  actionDescriptors: VacpActionDescriptor[];
}): VegaLiteDuckDbDataHandle | null {
  const { spec, view, options, actionRegistry, actionDescriptors } = args;

  const enableDuckDb = options.enableDuckDbDataHandle ?? true;
  if (!enableDuckDb) return null;

  const handleRef = makeRef({
    appId: options.appId,
    viewId: options.viewId,
    vizId: options.vizId,
    suffix: '/data/main',
  }) as VacpRef;

  const duckdbPromise: Promise<VacpDuckDbClient> = (() => {
    if (options.duckdbClient) return Promise.resolve(options.duckdbClient);
    const rootAny = globalThis as unknown as Record<string, unknown>;
    const existing = rootAny.__vacpDuckDbClient;
    if (existing && typeof (existing as Promise<unknown>).then === 'function')
      return existing as Promise<VacpDuckDbClient>;
    const created: Promise<VacpDuckDbClient> = createDuckDbWasmClient({ log: false });
    rootAny.__vacpDuckDbClient = created;
    return created;
  })();

  // DuckDB is shared across the page, so we use unique per-install table names
  // and best-effort cleanup for this view key.
  const tableName = (() => {
    const base = `vacp_vl_${options.appId}_${options.viewId}_${options.vizId}`;
    const name = makeVacpDuckDbTableName({ prefix: base });

    const viewKey = `${options.appId}/${options.viewId}/${options.vizId}`;
    const rootAny = globalThis as unknown as { __vacpVegaLiteDuckDbTables?: Record<string, string> };
    const map = (rootAny.__vacpVegaLiteDuckDbTables ??= {});
    const prev = map[viewKey];
    map[viewKey] = name;
    if (prev && prev !== name) {
      void duckdbPromise.then((db) => db.exec(`DROP TABLE IF EXISTS main.${prev}`)).catch(() => {});
    }

    return name;
  })();

  let duckdbLoad: Promise<void> | null = null;
  const ensureDuckDbData = async (): Promise<void> => {
    if (duckdbLoad) return await duckdbLoad;

    duckdbLoad = (async () => {
      let dataRows: unknown[] | null = null;
      for (let i = 0; i < 40; i += 1) {
        dataRows = selectRowsFromView(spec, view);
        if (Array.isArray(dataRows) && dataRows.length) break;
        await sleep(250);
      }
      if (!dataRows || !dataRows.length) throw new Error('No Vega-Lite rows available to load into DuckDB');

      const db = await duckdbPromise;
      const rows = dataRows
        .map((d) => (d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : null))
        .map((d) => {
          if (!d) return null;
          const out: Record<string, unknown> = {};
          let hasAny = false;
          for (const [k, v] of Object.entries(d)) {
            out[k] = sanitizeDuckDbValue(v);
            hasAny = true;
          }
          return hasAny ? out : null;
        })
        .filter((d): d is Record<string, unknown> => !!d);

      const fieldSet = new Set<string>();
      for (const row of rows.slice(0, 250)) {
        Object.keys(row).forEach((k) => fieldSet.add(k));
      }
      (view as unknown as { __vacpVegaLiteDuckDbFields?: string[] }).__vacpVegaLiteDuckDbFields = Array.from(fieldSet);

      try {
        await db.exec(`DROP VIEW IF EXISTS main.${tableName}`);
        await db.exec(`DROP TABLE IF EXISTS main.${tableName}`);
      } catch {
        // best-effort
      }

      try {
        await db.loadObjectsAsTable(tableName, rows, { create: true });
        return;
      } catch (err) {
        // Fall back to a "truncate + insert" approach.
        try {
          await db.exec(`DELETE FROM main.${tableName}`);
        } catch {
          // ignore
        }
        try {
          await db.loadObjectsAsTable(tableName, rows, { create: false });
          return;
        } catch {
          await db.loadObjectsAsTable(tableName, rows, { create: true });
        }
        void err;
      }
    })();

    try {
      await duckdbLoad;
    } catch (err) {
      duckdbLoad = null;
      throw err;
    }
  };

  void ensureDuckDbData().catch(() => {});

  let meta: VacpDuckDbTableMetadata | null = null;
  const ensureMetadata = async (): Promise<VacpDuckDbTableMetadata | null> => {
    if (meta) return meta;
    try {
      await ensureDuckDbData();
    } catch {
      meta = null;
      return meta;
    }
    const db = await duckdbPromise;
    try {
      meta = await getDuckDbTableMetadata({ duckdb: db, table: tableName, sampleRows: 25_000 });
    } catch {
      meta = null;
    }
    return meta;
  };

  const dataSqlDesc = registerVacpDataSqlAction(
    actionRegistry,
    createDuckDbDataSqlHandler({
      duckdb: {
        getConnection: () => duckdbPromise.then((d) => d.getConnection()),
        exec: (sql) => duckdbPromise.then((d) => d.exec(sql)),
        queryJson: (sql) => duckdbPromise.then((d) => d.queryJson(sql)),
        queryArrowIpcBase64: (sql) => duckdbPromise.then((d) => d.queryArrowIpcBase64(sql)),
        loadObjectsAsTable: (t, rows, opts) => duckdbPromise.then((d) => d.loadObjectsAsTable(t, rows, opts)),
      },
      resolveHandle: async (ref) => {
        if (ref !== handleRef) return null;
        await ensureDuckDbData();
        const allSql = `SELECT * FROM ${tableName}`;
        const where = whereClauseForCurrentSelections(spec, view);
        const selectedSql = where ? `SELECT * FROM ${tableName} WHERE ${where}` : allSql;
        return { allSql, selectedSql };
      },
    }),
    { targetRef: handleRef, description: 'Query the current Vega-Lite selection using DuckDB SQL.' },
  );
  actionDescriptors.push(dataSqlDesc);

  return { ref: handleRef, tableName, ensureMetadata };
}
