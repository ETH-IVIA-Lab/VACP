import { type VacpActionDescriptor, type VacpRef } from '@vacp/protocol';
import { getVacpBrowserOptions } from '@vacp/runtime-browser';
import type { VacpDuckDbClient, VacpDuckDbTableMetadata } from '@vacp/data-duckdb';
import {
  createDuckDbDataSqlHandler,
  createDuckDbWasmClient,
  getDuckDbTableMetadata,
  makeVacpDuckDbTableName,
} from '@vacp/data-duckdb';
import { registerVacpDataSchemaAction, registerVacpDataSqlAction, type VacpActionRegistry } from '@vacp/runtime';

import { whereClauseForCurrentSelections } from './duckdb-selection';
import { collectVegaLiteParams } from './params';
import { makeRef } from './refs';
import type { InstallVacpOnVegaLiteOptions, VegaLiteSpecLike, VegaViewLike } from './types';

export type VegaLiteDuckDbDataHandle = {
  ref: VacpRef;
  tableName: string;
  title: string;
  sourceId: string;
  ensureMetadata: () => Promise<VacpDuckDbTableMetadata | null>;
};

// Keep hidden DuckDB handles off `window` when `expose-bridge=0`.
// These in-module caches keep DuckDB reuse without adding global surface area.
const HIDDEN_DUCKDB_CLIENTS = new Map<string, Promise<VacpDuckDbClient>>();

const HIDDEN_TABLE_NAMES = new Map<string, Record<string, string>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findEncodingField(spec: VegaLiteSpecLike, channel: string): string | null {
  const enc = spec.encoding;
  const field = enc && isRecord(enc) ? (enc[channel] as unknown) : null;

  if (field && isRecord(field)) {
    if (typeof field.field === 'string') return field.field;
    const cond = field.condition;

    if (isRecord(cond) && typeof cond.field === 'string') return cond.field;

    if (Array.isArray(cond)) {
      for (const c of cond) {
        if (isRecord(c) && typeof c.field === 'string') return c.field;
      }
    }
  }

  const children: unknown[] = [];

  if (Array.isArray(spec.layer)) children.push(...spec.layer);

  if (Array.isArray(spec.hconcat)) children.push(...spec.hconcat);

  if (Array.isArray(spec.vconcat)) children.push(...spec.vconcat);

  if (Array.isArray(spec.concat)) children.push(...spec.concat);

  if (spec.spec) children.push(spec.spec);

  for (const child of children) {
    if (!child || typeof child !== 'object') continue;
    const f = findEncodingField(child, channel);

    if (f) return f;
  }

  return null;
}

function collectSelectionFields(spec: VegaLiteSpecLike): string[] {
  const fields = new Set<string>();

  for (const p of collectVegaLiteParams(spec)) {
    if (!p.select || !isRecord(p.select)) continue;
    const select = p.select;

    const selectFields = Array.isArray(select.fields) ? select.fields : [];

    for (const f of selectFields) {
      if (typeof f === 'string' && f) fields.add(f);
    }

    const encodings = Array.isArray(select.encodings) ? select.encodings : [];

    for (const ch of encodings) {
      if (typeof ch !== 'string' || !ch) continue;
      const f = findEncodingField(spec, ch);

      if (f) fields.add(f);
    }
  }

  return Array.from(fields);
}

function parseDateMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (value instanceof Date) {
    const t = value.getTime();

    return Number.isFinite(t) ? t : null;
  }

  if (typeof value === 'string') {
    const s = value.trim();

    if (!s) return null;
    const n = Number(s);

    if (Number.isFinite(n)) return n;
    const t = Date.parse(s);

    return Number.isFinite(t) ? t : null;
  }

  return null;
}

function deriveMonthdateMs(ms: number): number | null {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);

  if (!Number.isFinite(d.getTime())) return null;
  const derived = new Date(2012, d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const t = derived.getTime();

  return Number.isFinite(t) ? t : null;
}

function collectMonthdateDerivedFields(spec: VegaLiteSpecLike): Array<{ sourceField: string; derivedField: string }> {
  const out: Array<{ sourceField: string; derivedField: string }> = [];
  const seen = new Set<string>();

  const add = (field: string) => {
    const sourceField = field;
    const derivedField = `monthdate_${field}`;
    const key = `${sourceField}=>${derivedField}`;

    if (seen.has(key)) return;
    seen.add(key);
    out.push({ sourceField, derivedField });
  };

  const walk = (s: VegaLiteSpecLike) => {
    const enc = s.encoding;

    if (enc && isRecord(enc)) {
      for (const v of Object.values(enc)) {
        if (!isRecord(v)) continue;

        if (typeof v.field === 'string' && typeof v.timeUnit === 'string' && v.timeUnit === 'monthdate') add(v.field);
        const cond = v.condition;

        if (isRecord(cond)) {
          if (typeof cond.field === 'string' && cond.timeUnit === 'monthdate') add(cond.field);
        } else if (Array.isArray(cond)) {
          for (const c of cond) {
            if (!isRecord(c)) continue;

            if (typeof c.field === 'string' && c.timeUnit === 'monthdate') add(c.field);
          }
        }
      }
    }

    const children: unknown[] = [];

    if (Array.isArray(s.layer)) children.push(...s.layer);

    if (Array.isArray(s.hconcat)) children.push(...s.hconcat);

    if (Array.isArray(s.vconcat)) children.push(...s.vconcat);

    if (Array.isArray(s.concat)) children.push(...s.concat);

    if (s.spec) children.push(s.spec);

    for (const child of children) {
      if (!child || typeof child !== 'object') continue;
      walk(child);
    }
  };

  walk(spec);

  return out;
}

function sanitizeDuckDbValue(value: unknown) {
  if (value === undefined) return null;

  if (value === null) return null;

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;

  if (typeof value === 'bigint') return value.toString();

  if (value instanceof Date) {
    const t = value.getTime();

    return Number.isFinite(t) ? t : null;
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

type SpecDataSource = {
  key: string;
  id: string;
  title: string;
  url?: string;
  format?: any;
  values?: unknown[];
};

function sanitizeDataSourceId(value: string): string {
  const cleaned = value
    .replaceAll(/[/\\]+/g, '_')
    .replaceAll(/[^a-zA-Z0-9_-]+/g, '_')
    .replaceAll(/_+/g, '_')
    .replaceAll(/^_+|_+$/g, '');

  return cleaned || 'data';
}

function dataSourceFromDataObject(
  data: unknown,
): { key: string; id: string; title: string; url?: string; format?: unknown; values?: unknown[] } | null {
  if (!data || typeof data !== 'object') return null;
  const rec = data as Record<string, unknown>;

  const url = typeof rec.url === 'string' ? rec.url : null;
  const values = Array.isArray(rec.values) ? rec.values : null;
  const format = rec.format;

  if (url) {
    const urlKey = url.trim();
    const fmt = isRecord(format) ? format : null;
    const fmtType = fmt && typeof fmt.type === 'string' ? fmt.type : '';
    const feature = fmt && typeof fmt.feature === 'string' ? fmt.feature : '';
    const key = `url:${urlKey}|type:${fmtType}|feature:${feature}`;

    const file = urlKey.split('?')[0]?.split('#')[0]?.split('/').filter(Boolean).pop() ?? urlKey;
    const stem = file.replaceAll(/\.[^.]+$/g, '') || file;
    const suffix = fmtType === 'topojson' && feature ? `_${feature}` : '';
    const id = sanitizeDataSourceId(`${stem}${suffix}`);
    const title = `${file}${suffix ? ` (${feature})` : ''}`;

    return { key, id, title, url: urlKey, format };
  }

  if (values) {
    const key = `values:${values.length}`;
    const id = sanitizeDataSourceId(`inline_${values.length}`);
    const title = `inline values (${values.length} rows)`;

    return { key, id, title, values };
  }

  return null;
}

function collectSpecDataSources(spec: VegaLiteSpecLike): SpecDataSource[] {
  const out: SpecDataSource[] = [];
  const seen = new Set<string>();

  const add = (data: unknown) => {
    const ds = dataSourceFromDataObject(data);

    if (!ds) return;

    if (seen.has(ds.key)) return;
    seen.add(ds.key);
    out.push(ds);
  };

  const walk = (s: VegaLiteSpecLike) => {
    add(s.data);

    const transforms = Array.isArray(s.transform) ? s.transform : [];

    for (const t of transforms) {
      if (!t || typeof t !== 'object') continue;
      const rec = t as Record<string, unknown>;
      const from = rec.from;
      const fromRec = isRecord(from) ? from : null;

      if (fromRec && 'data' in fromRec) add(fromRec.data);
    }

    const children: unknown[] = [];

    if (Array.isArray(s.layer)) children.push(...s.layer);

    if (Array.isArray(s.hconcat)) children.push(...s.hconcat);

    if (Array.isArray(s.vconcat)) children.push(...s.vconcat);

    if (Array.isArray(s.concat)) children.push(...s.concat);

    if (s.spec) children.push(s.spec);

    for (const child of children) {
      if (!child || typeof child !== 'object') continue;
      walk(child);
    }
  };

  walk(spec);

  return out;
}

function resolveDatasetNameByIndex(view: VegaViewLike, index: number): string | null {
  if (typeof view.data !== 'function') return null;
  // Prefer `source_*` for stable mapping from a spec's data sources to Vega datasets.
  // (`data_*` numbering can diverge due to per-layer/per-transform intermediate datasets.)
  const prefixes = ['source_', 'data_'];

  for (const prefix of prefixes) {
    const name = `${prefix}${index}`;

    try {
      const rows = view.data(name);

      if (Array.isArray(rows)) return name;
    } catch {
      // ignore
    }
  }

  return null;
}

function allowedFieldsForHandleFromView(view: VegaViewLike, handleRef: VacpRef): Set<string> | null {
  const anyView = view as { __vacpVegaLiteDuckDbFieldsByHandle?: unknown };
  const raw = anyView.__vacpVegaLiteDuckDbFieldsByHandle;

  if (!raw || typeof raw !== 'object') return null;
  const list = (raw as Record<string, unknown>)[handleRef];

  if (!Array.isArray(list)) return null;
  const fields = list.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);

  return fields.length ? new Set(fields) : null;
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

      if (isRecord(v) && Array.isArray(v.values)) {
        candidates.push({ name, rows: v.values as unknown[] });
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
    .flatMap((c) => {
      const score = scoreCandidate(c);
      return score >= 0 && c.rows.length > 0 ? [{ ...c, score }] : [];
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.rows ?? null;
}

/**
 * Optional DuckDB-backed DataHandles for Vega-Lite specs.
 *
 * This keeps DuckDB "first class" without requiring any additional data APIs:
 * - providers expose one semantic action: `vacp.data_sql`
 * - inspector and transports can query selection state with SQL only
 */
export function installVegaLiteDuckDbDataHandles(args: {
  spec: VegaLiteSpecLike;
  view: VegaViewLike;
  options: InstallVacpOnVegaLiteOptions;
  actionRegistry: VacpActionRegistry;
  actionDescriptors: VacpActionDescriptor[];
}): VegaLiteDuckDbDataHandle[] {
  const { spec, view, options, actionRegistry, actionDescriptors } = args;

  const enableDuckDb = options.enableDuckDbDataHandle ?? true;

  if (!enableDuckDb) return [];

  const globalKey = typeof options.globalKey === 'string' && options.globalKey.length ? options.globalKey : '__vacp';
  const exposeBridge = getVacpBrowserOptions().exposeBridge;

  const duckdbPromise: Promise<VacpDuckDbClient> = (() => {
    if (options.duckdbClient) return Promise.resolve(options.duckdbClient);

    if (!exposeBridge) {
      const existing = HIDDEN_DUCKDB_CLIENTS.get(globalKey);

      if (existing) return existing;
      const created: Promise<VacpDuckDbClient> = createDuckDbWasmClient({ log: false });
      HIDDEN_DUCKDB_CLIENTS.set(globalKey, created);

      return created;
    }

    const rootAny = globalThis as Record<string, unknown>;
    const key = `${globalKey}DuckDbClient`;
    const existing = rootAny[key];

    if (existing && typeof (existing as Promise<unknown>).then === 'function')
      return existing as Promise<VacpDuckDbClient>;
    const created: Promise<VacpDuckDbClient> = createDuckDbWasmClient({ log: false });
    rootAny[key] = created;

    return created;
  })();

  const base = `vacp_vl_${options.appId}_${options.viewId}_${options.vizId}`;
  const viewKey = `${options.appId}/${options.viewId}/${options.vizId}`;

  const sources = collectSpecDataSources(spec);
  const fallback = sources.length === 0;
  const monthdateDerivations = collectMonthdateDerivedFields(spec);

  const sourcesWithDatasets: Array<SpecDataSource & { datasetIndex: number; datasetName: string | null }> = fallback
    ? [
        {
          key: 'fallback',
          id: 'main',
          title: 'data',
          datasetIndex: 0,
          datasetName: null,
        } satisfies SpecDataSource & {
          datasetIndex: number;
          datasetName: string | null;
        },
      ]
    : sources.map((s, i) => ({ ...s, datasetIndex: i, datasetName: resolveDatasetNameByIndex(view, i) }));

  // Pick a "primary" source to keep `/data/main` consistent across Vega-Lite views.
  const requiredFields = collectSelectionFields(spec);

  const pickBest = (rows: unknown[]): Record<string, unknown> | null =>
    rows.find((r) => isRecord(r)) as Record<string, unknown> | null;

  const scoreRows = (rows: unknown[] | null): number => {
    if (!rows || !rows.length) return -1;
    const sample = pickBest(rows);

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
    const sizeScore = Math.log10(Math.max(1, rows.length));
    let score = 0;
    score += fieldMatches * 1000;
    score += primitiveFields * 10;
    score -= nestedFields * 50;
    score += sizeScore;

    if (looksGeoJson || hasGeometry) score -= 250;

    return score;
  };

  const primaryIndex = (() => {
    let best = 0;
    let bestScore = -Infinity;
    sourcesWithDatasets.forEach((s, i) => {
      if (!s.datasetName || typeof view.data !== 'function') return;
      let rows: unknown[] | null = null;

      try {
        const r = view.data(s.datasetName);

        if (Array.isArray(r)) rows = r;
      } catch {
        rows = null;
      }

      const score = scoreRows(rows);

      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    });

    return best;
  })();

  const handlesInternal: Array<
    VegaLiteDuckDbDataHandle & {
      datasetName: string | null;
      ensureDuckDbData: () => Promise<void>;
    }
  > = [];

  sourcesWithDatasets.forEach((s, idx) => {
    const suffix = idx === primaryIndex ? '/data/main' : `/data/src/${s.id}`;

    const handleRef = makeRef({
      appId: options.appId,
      viewId: options.viewId,
      vizId: options.vizId,
      suffix,
    });

    // DuckDB is shared across the page, so each install receives unique table names.
    const tableName = (() => {
      const name = makeVacpDuckDbTableName({ prefix: base, parts: [s.id] });

      const cacheKey = `${globalKey}|${viewKey}`;

      if (!exposeBridge) {
        const viewMap = HIDDEN_TABLE_NAMES.get(cacheKey) ?? {};
        const prev = viewMap[suffix] ?? null;
        viewMap[suffix] = name;
        HIDDEN_TABLE_NAMES.set(cacheKey, viewMap);

        if (prev && prev !== name)
          void duckdbPromise.then((db) => db.exec(`DROP TABLE IF EXISTS main.${prev}`)).catch(() => {});

        return name;
      }

      const rootAny = globalThis as Record<string, unknown>;
      const key = `${globalKey}VegaLiteDuckDbTables`;

      const map = (() => {
        const raw = rootAny[key];

        if (raw instanceof Map) {
          // Backwards/forwards safety during hot reload: if a previous version stored a Map, drop it.
          const created: Record<string, unknown> = {};
          rootAny[key] = created;

          return created;
        }

        if (isRecord(raw)) return raw;
        const created: Record<string, unknown> = {};
        rootAny[key] = created;

        return created;
      })() as Record<string, string | Record<string, string>>;

      const prevValue = map[viewKey];

      const viewMap: Record<string, string> = typeof prevValue === 'object' && prevValue !== null ? prevValue : {};

      const prev = viewMap[suffix] ?? null;
      viewMap[suffix] = name;
      map[viewKey] = viewMap;

      if (typeof prevValue === 'string' && prevValue) {
        void duckdbPromise.then((db) => db.exec(`DROP TABLE IF EXISTS main.${prevValue}`)).catch(() => {});
      }

      if (prev && prev !== name) {
        void duckdbPromise.then((db) => db.exec(`DROP TABLE IF EXISTS main.${prev}`)).catch(() => {});
      }

      return name;
    })();

    let duckdbLoad: Promise<void> | null = null;
    let duckdbFingerprint: string | null = null;

    const variableParamNames = collectVegaLiteParams(spec)
      .filter((p) => !p.select && typeof p.name === 'string' && p.name)
      .map((p) => p.name);

    const readCurrentDataRows = async (): Promise<unknown[] | null> => {
      let dataRows: unknown[] | null = null;

      for (let i = 0; i < 40; i += 1) {
        if (s.values) {
          dataRows = s.values;
        } else if (s.datasetName && typeof view.data === 'function') {
          try {
            const rows = view.data(s.datasetName);
            dataRows = Array.isArray(rows) ? rows : null;
          } catch {
            dataRows = null;
          }
        } else if (fallback) {
          dataRows = selectRowsFromView(spec, view);
        }

        if (Array.isArray(dataRows) && dataRows.length) break;
        await sleep(250);
      }

      return dataRows;
    };

    const fingerprintForRows = (dataRows: unknown[]): string => {
      const sample = dataRows.slice(0, 5).map((row) => {
        if (!isRecord(row)) return sanitizeDuckDbValue(row);
        const keys = Object.keys(row).sort().slice(0, 12);
        const out: Record<string, unknown> = {};

        for (const k of keys) out[k] = sanitizeDuckDbValue(row[k]);

        return out;
      });

      const params: Record<string, unknown> = {};

      for (const name of variableParamNames) {
        try {
          params[name] = sanitizeDuckDbValue(view.signal(name));
        } catch {
          params[name] = null;
        }
      }

      return JSON.stringify({ n: dataRows.length, sample, params });
    };

    const ensureDuckDbData = async (): Promise<void> => {
      const dataRows = await readCurrentDataRows();

      if (!dataRows || !dataRows.length)
        throw new Error(`No Vega-Lite rows available to load into DuckDB (${s.title})`);

      const nextFingerprint = fingerprintForRows(dataRows);

      if (duckdbLoad && duckdbFingerprint === nextFingerprint) return await duckdbLoad;

      duckdbFingerprint = nextFingerprint;
      duckdbLoad = (async () => {
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

            // Add derived `monthdate_*` fields for specs that use `timeUnit: "monthdate"`.
            // This keeps `vacp.data_sql` selection filtering working even when we load `source_*`
            // datasets (which typically do not include Vega-Lite's derived timeUnit fields).
            for (const deriv of monthdateDerivations) {
              if (Object.prototype.hasOwnProperty.call(out, deriv.derivedField)) continue;

              if (!Object.prototype.hasOwnProperty.call(d, deriv.sourceField)) continue;
              const ms = parseDateMs(d[deriv.sourceField]);

              if (ms === null) continue;
              const derivedMs = deriveMonthdateMs(ms);

              if (derivedMs === null) continue;
              out[deriv.derivedField] = derivedMs;
              hasAny = true;
            }

            return hasAny ? out : null;
          })
          .filter((d): d is Record<string, unknown> => !!d);

        const fieldSet = new Set<string>();

        for (const row of rows.slice(0, 250)) {
          Object.keys(row).forEach((k) => fieldSet.add(k));
        }

        const viewAny = view as {
          __vacpVegaLiteDuckDbFields?: string[];
          __vacpVegaLiteDuckDbFieldsByHandle?: Record<string, string[]>;
        };

        (viewAny.__vacpVegaLiteDuckDbFieldsByHandle ??= {})[handleRef] = Array.from(fieldSet);

        if (suffix === '/data/main') viewAny.__vacpVegaLiteDuckDbFields = Array.from(fieldSet);

        try {
          await db.exec(`DROP VIEW IF EXISTS main.${tableName}`);
          await db.exec(`DROP TABLE IF EXISTS main.${tableName}`);
        } catch {
          // The table may not exist yet.
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
        meta = await getDuckDbTableMetadata({
          duckdb: db,
          table: tableName,
          sampleRows: 0,
          maxNumericColumns: 0,
          maxTemporalColumns: 0,
          maxCategoricalColumns: 0,
        });
      } catch {
        meta = null;
      }

      return meta;
    };

    handlesInternal.push({
      ref: handleRef,
      tableName,
      title: s.title,
      sourceId: s.id,
      datasetName: s.datasetName,
      ensureDuckDbData,
      ensureMetadata,
    });
  });

  // Put the primary `/data/main` handle first so tools (and tests) that pick the
  // "first DataHandle" consistently get the intended main dataset.
  handlesInternal.sort((a, b) => {
    const aMain = a.ref.endsWith('/data/main');
    const bMain = b.ref.endsWith('/data/main');

    if (aMain !== bMain) return aMain ? -1 : 1;

    return a.ref.localeCompare(b.ref);
  });

  const handlesByRef = new Map(handlesInternal.map((h) => [h.ref, h] as const));
  const schemaCache = new Map<string, VacpDuckDbTableMetadata>();

  const dataSqlDesc = registerVacpDataSqlAction(
    actionRegistry,
    createDuckDbDataSqlHandler({
      duckdb: {
        exec: (sql) => duckdbPromise.then((d) => d.exec(sql)),
        queryJson: (sql) => duckdbPromise.then((d) => d.queryJson(sql)),
        queryArrowIpcBase64: (sql) => duckdbPromise.then((d) => d.queryArrowIpcBase64(sql)),
        loadObjectsAsTable: (t, rows, opts) => duckdbPromise.then((d) => d.loadObjectsAsTable(t, rows, opts)),
      },
      resolveHandle: async (ref) => {
        const handle = handlesByRef.get(ref);

        if (!handle) return null;
        await handle.ensureDuckDbData();
        const allSql = `SELECT * FROM ${handle.tableName}`;
        const where = whereClauseForCurrentSelections(spec, view, allowedFieldsForHandleFromView(view, handle.ref));
        const selectedSql = where ? `SELECT * FROM ${handle.tableName} WHERE ${where}` : allSql;

        return { allSql, selectedSql };
      },
    }),
    {
      targetRef: handlesInternal.find((h) => h.ref.endsWith('/data/main'))?.ref,
      enabled: getVacpBrowserOptions().enableSql,
      description: 'Query the current Vega-Lite selection using DuckDB SQL.',
    },
  );

  if (dataSqlDesc) actionDescriptors.push(dataSqlDesc);

  const dataSchemaDesc = registerVacpDataSchemaAction(
    actionRegistry,
    async (params) => {
      const handle = handlesByRef.get(params.handleRef);

      if (!handle) throw new Error(`Unknown DataHandle: ${params.handleRef}`);

      await handle.ensureDuckDbData();
      const db = await duckdbPromise;

      const detail = params.detail ?? 'columns';
      const sampleRows = params.sampleRows;

      const cacheKey =
        detail === 'full'
          ? `${handle.tableName}|full|${typeof sampleRows === 'number' ? sampleRows : 'default'}`
          : `${handle.tableName}|columns`;

      const cached = schemaCache.get(cacheKey);

      if (cached) return { handleRef: params.handleRef, detail, ...cached };

      const meta = await getDuckDbTableMetadata({
        duckdb: db,
        table: handle.tableName,
        sampleRows: detail === 'full' ? (sampleRows ?? 25_000) : 0,
        maxNumericColumns: detail === 'full' ? undefined : 0,
        maxTemporalColumns: detail === 'full' ? undefined : 0,
        maxCategoricalColumns: detail === 'full' ? undefined : 0,
      });

      schemaCache.set(cacheKey, meta);

      return { handleRef: params.handleRef, detail, ...meta };
    },
    {
      targetRef: handlesInternal.find((h) => h.ref.endsWith('/data/main'))?.ref,
      description: 'Return DuckDB schema/metadata for a Vega-Lite DataHandle (columns, types, and optional summaries).',
    },
  );

  actionDescriptors.push(dataSchemaDesc);

  return handlesInternal;
}
