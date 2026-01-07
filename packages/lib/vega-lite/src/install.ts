import type {
  VacpActionCall,
  VacpActionDescriptor,
  VacpCapabilitiesSnapshot,
  VacpChangeSource,
  VacpRef,
  VacpStateSnapshot,
} from '@vacp/core';
import { nowIso, VACP_SCHEMA_VERSION } from '@vacp/core';
import { applyVacpAttributes, applyVacpInteractionAttributes, embedVacpGraphInSvg } from '@vacp/dom';
import type { VacpDuckDbClient } from '@vacp/duckdb';
import { createDuckDbDataSqlHandler, createDuckDbWasmClient } from '@vacp/duckdb';
import { installVacpRuntimeBridge, registerVacpApplyStateAction, VacpActionRegistry } from '@vacp/gateway';
import { registerVacpDataSqlAction } from '@vacp/gateway';

import { actionsForSpec } from './actions';
import { buildGraph } from './graph';
import { buildParamLookup, executeAction } from './execute';
import { whereClauseForCurrentSelections } from './duckdb-selection';
import { makeRef } from './refs';
import { tryGetSignal } from './signals';
import type { InstallVacpOnVegaLiteOptions, VegaLiteSpecLike, VegaViewLike } from './types';

/**
 * Vega-Lite provider (project concepts).
 *
 * Vega-Lite defines parameters (`params`) for interactivity:
 * - variable params (scalars) can be bound to inputs or modified via signals
 * - selection params define interactive selections and compile to signals/state
 *
 * For VACP, parameters are the natural first-class control/state surface.
 */
export function installVacpOnVegaLiteView(args: {
  root: HTMLElement;
  view: VegaViewLike;
  spec: VegaLiteSpecLike;
  options: InstallVacpOnVegaLiteOptions;
}): void {
  const { root, view, spec, options } = args;

  const actionRegistry = new VacpActionRegistry();
  let lastChangeSource: VacpChangeSource = 'human';

  const helpers = buildParamLookup(spec, view);

  const actionDescriptors: VacpActionDescriptor[] = actionsForSpec(options, spec);
  actionDescriptors.forEach((desc) => {
    actionRegistry.register(desc, async (params) => {
      lastChangeSource = 'agent';
      try {
        const call: VacpActionCall = { callId: crypto.randomUUID(), name: desc.name, params };
        return await executeAction(view, call, helpers);
      } finally {
        queueMicrotask(() => {
          lastChangeSource = 'human';
        });
      }
    });
  });

  // Standard, generic action for "apply this desired state map" (best-effort).
  const vizRef = makeRef({ appId: options.appId, viewId: options.viewId, vizId: options.vizId, suffix: '' });
  const applyDescriptor = registerVacpApplyStateAction(
    actionRegistry,
    async (state) => {
      const errors: Array<{ ref: string; message: string }> = [];
      let applied = 0;

      for (const [ref, raw] of Object.entries(state)) {
        const name = ref.split('/param/')[1];
        if (!name) continue;
        const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        const desired = (rec.value ?? raw) as unknown;
        const callId = crypto.randomUUID();
        lastChangeSource = 'agent';
        try {
          if (desired === null || desired === undefined) {
            await executeAction(view, { callId, name: 'vega_lite.clear_selection', params: { ref } }, helpers);
          } else {
            await executeAction(
              view,
              { callId, name: 'vega_lite.set_param', params: { ref, value: desired } },
              helpers,
            );
          }
          applied += 1;
        } catch (err) {
          errors.push({ ref, message: err instanceof Error ? err.message : String(err) });
        } finally {
          queueMicrotask(() => {
            lastChangeSource = 'human';
          });
        }
      }

      return { applied, errors };
    },
    { targetRef: vizRef, description: 'Apply a state map to Vega-Lite params (best-effort).' },
  );
  actionDescriptors.push(applyDescriptor);

  const enableDuckDb = options.enableDuckDbDataHandle ?? true;
  const inlineValues = spec.data && typeof spec.data === 'object' && Array.isArray((spec.data as any).values);
  const dataRows = inlineValues ? ((spec.data as any).values as unknown[]) : null;
  const handleRef = enableDuckDb && dataRows ? (makeRef({
    appId: options.appId,
    viewId: options.viewId,
    vizId: options.vizId,
    suffix: '/data/main',
  }) as VacpRef) : null;
  const duckdbPromise: Promise<VacpDuckDbClient> | null = (() => {
    if (!handleRef) return null;
    if (options.duckdbClient) return Promise.resolve(options.duckdbClient);
    const rootAny = globalThis as unknown as Record<string, unknown>;
    const existing = rootAny.__vacpDuckDbClient;
    if (existing && typeof (existing as Promise<unknown>).then === 'function') return existing as Promise<VacpDuckDbClient>;
    const created: Promise<VacpDuckDbClient> = createDuckDbWasmClient({ log: false });
    rootAny.__vacpDuckDbClient = created;
    return created;
  })();
  // Important: DuckDB is global (shared) in the browser. In the example gallery,
  // we can re-initialize the same spec multiple times during reactive updates.
  // Use a per-install unique table name to avoid "already exists" races.
  const tableName = (() => {
    if (!handleRef) return null;
    const base = `vacp_vl_${options.appId}_${options.viewId}_${options.vizId}`.replaceAll(/[^a-zA-Z0-9_]/g, '_');
    const suffix = typeof crypto.randomUUID === 'function' ? crypto.randomUUID().slice(0, 8) : String(Date.now());
    const name = `${base}_${suffix}`;

    // Best-effort cleanup: if we previously created a table for this view key,
    // drop it so the shared in-browser DuckDB doesn't grow unbounded.
    const viewKey = `${options.appId}/${options.viewId}/${options.vizId}`;
    const rootAny = globalThis as unknown as { __vacpVegaLiteDuckDbTables?: Record<string, string> };
    const map = (rootAny.__vacpVegaLiteDuckDbTables ??= {});
    const prev = map[viewKey];
    map[viewKey] = name;
    if (prev && prev !== name && duckdbPromise) {
      void duckdbPromise.then((db) => db.exec(`DROP TABLE IF EXISTS main.${prev}`)).catch(() => {});
    }

    return name;
  })();

  let duckdbLoad: Promise<void> | null = null;
  const ensureDuckDbData = async (): Promise<void> => {
    if (!duckdbPromise || !tableName || !dataRows) return;
    if (!duckdbLoad) {
      duckdbLoad = (async () => {
        const db = await duckdbPromise;
        const rows = dataRows
          .map((d) => (d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : null))
          .filter((d): d is Record<string, unknown> => !!d);
        try {
          await db.exec(`DROP VIEW IF EXISTS main.${tableName}`);
          await db.exec(`DROP TABLE IF EXISTS main.${tableName}`);
        } catch {
          // Best-effort; the table name is unique per install, so existence
          // here is not required for correctness.
        }

        try {
          await db.loadObjectsAsTable(tableName, rows, { create: true });
          return;
        } catch (err) {
          // Some DuckDB-WASM builds can race/lag catalog changes (or reactive
          // render loops can re-run installs) and CREATE can see "exists" even
          // after drops. Fall back to a "truncate + insert" approach.
          try {
            await db.exec(`DELETE FROM main.${tableName}`);
          } catch {
            // ignore
          }
          try {
            await db.loadObjectsAsTable(tableName, rows, { create: false });
            return;
          } catch {
            // Last resort: retry create once more (the original error is likely
            // transient catalog state); bubble if it still fails.
            await db.loadObjectsAsTable(tableName, rows, { create: true });
          }
          void err;
        }
      })();
    }
    await duckdbLoad;
  };

  if (duckdbPromise) void ensureDuckDbData().catch(() => {});

  if (handleRef && duckdbPromise && tableName) {
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
  }

  const graph = buildGraph({
    spec,
    options,
    actions: actionDescriptors,
    dataHandle: handleRef ? { ref: handleRef, data: { tableName } } : undefined,
  });

  applyVacpAttributes(root, {
    ref: vizRef,
    layer: 'ViewLayer',
    kind: 'View',
    title: options.title,
    description: options.description,
    data: { vizId: options.vizId, provider: 'vega-lite' },
  });
  applyVacpInteractionAttributes(root, {
    targetRef: vizRef,
    layer: 'ViewLayer',
    description: 'Programmatic interactions for this Vega-Lite view.',
    actions: actionDescriptors,
  });

  const svg = root.querySelector('svg');
  if (svg) embedVacpGraphInSvg(svg, graph);

  const snapshots = {
    getCapabilities: async (): Promise<VacpCapabilitiesSnapshot> => ({
      version: VACP_SCHEMA_VERSION,
      createdAt: nowIso(),
      graph,
    }),
    getState: async (): Promise<VacpStateSnapshot> => {
      const state: Record<string, unknown> = {};
      (spec.params ?? []).forEach((p) => {
        const pref = makeRef({
          appId: options.appId,
          viewId: options.viewId,
          vizId: options.vizId,
          suffix: `/param/${p.name}`,
        });
        const kind = p.select ? 'Selection' : 'Param';
        state[pref] = p.select
          ? { kind, name: p.name, value: tryGetSignal(view, p.name), select: p.select }
          : { kind, name: p.name, value: tryGetSignal(view, p.name), bind: p.bind };
      });
      if (handleRef) {
        state[handleRef] = {
          kind: 'DataHandle',
          tableName,
          selectionWhere: whereClauseForCurrentSelections(spec, view),
          selectedMeaning: 'rows matching current selection params; falls back to all rows if none',
        };
      }
      return { version: VACP_SCHEMA_VERSION, createdAt: nowIso(), state: state as any };
    },
  };

  const bridge = installVacpRuntimeBridge({
    snapshots,
    actions: actionRegistry,
    demos: options.demos,
    globalKey: options.globalKey,
  });

  // Keep the runtime timeline updated on human-driven signal changes.
  if (typeof view.addSignalListener === 'function') {
    let pendingTimer: number | null = null;
    const onSignal = () => {
      if (pendingTimer !== null) return;
      pendingTimer = window.setTimeout(() => {
        pendingTimer = null;
        if (typeof bridge.refresh === 'function') {
          void bridge.refresh({ source: lastChangeSource, message: 'signal change' }).catch(() => {});
        }
      }, 120);
    };

    const watched = new Set<string>();
    (spec.params ?? []).forEach((p) => {
      (helpers.watchedSignalsByParam.get(p.name) ?? [p.name]).forEach((s) => watched.add(s));
    });
    watched.forEach((s) => view.addSignalListener?.(s, onSignal));
  }
}
