import type { VacpActionCall, VacpActionDescriptor, VacpProvider, VacpSourceId } from '@vacp/protocol';
import { formatDuckDbTableMetadataSummary } from '@vacp/data-duckdb';
import { createVacpProvider, registerVacpApplyStateAction, VacpActionRegistry } from '@vacp/runtime';

import { actionsForSpec } from './actions.js';
import { buildGraph } from './graph.js';
import { buildParamLookup, executeAction } from './execute.js';
import { createVegaLiteDataBinding } from './duckdb-handle.js';
import { whereClauseForCurrentSelections } from './duckdb-selection.js';
import { collectVegaLiteParams } from './params.js';
import { makeRef } from './refs.js';
import { tryGetSignal } from './signals.js';
import type { VegaLiteProviderOptions, VegaLiteSpecLike, VegaViewLike } from './types.js';

import { createVegaLiteTooltipBinding } from './tooltip.js';
import { createVegaLiteObservationBinding } from './observe.js';

const DATA_HANDLE_META_TIMEOUT_MS = 1_500;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = globalThis.setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) globalThis.clearTimeout(timer);
  }
}

/**
 * Vega-Lite provider (project concepts).
 *
 * Vega-Lite defines parameters (`params`) for interactivity:
 * - variable params (scalars) can be bound to inputs or modified via signals
 * - selection params define interactive selections and compile to signals/state
 *
 * For VACP, parameters are the natural first-class control/state surface.
 */
export function createVegaLiteProvider(args: {
  root?: HTMLElement;
  view: VegaViewLike;
  spec: VegaLiteSpecLike;
  options: VegaLiteProviderOptions;
}): VacpProvider {
  const { view, spec, options } = args;

  const sourceId: VacpSourceId = `vacp-source://${options.appId}/${options.viewId}/${options.vizId}/vega-lite`;
  const actionRegistry = new VacpActionRegistry(sourceId);

  const helpers = buildParamLookup(spec, view, options);

  const actionDescriptors: VacpActionDescriptor[] = actionsForSpec(options, spec);
  actionDescriptors.forEach((desc) => {
    actionRegistry.register({ ...desc, operation: { ...desc.operation, contract: desc.name } }, async (params) => {
      const call: VacpActionCall = { callId: crypto.randomUUID(), name: desc.name, params };
      return executeAction(view, call, helpers);
    });
  });

  // Standard action for applying a desired state map through provider refs.
  const vizRef = makeRef({ appId: options.appId, viewId: options.viewId, vizId: options.vizId, suffix: '' });

  const applyDescriptor = registerVacpApplyStateAction(
    actionRegistry,
    async (state) => {
      const errors: Array<{ ref: string; message: string }> = [];
      let applied = 0;

      for (const [ref, raw] of Object.entries(state)) {
        if (!helpers.paramByRef.has(ref)) continue;
        const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        const desired = (rec.value ?? raw) as unknown;
        const callId = crypto.randomUUID();

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
        }
      }

      return { applied, errors };
    },
    { affects: [vizRef], description: 'Apply a state map to Vega-Lite params.' },
  );

  actionDescriptors.push(applyDescriptor);

  const tooltip = createVegaLiteTooltipBinding({
    view,
    spec,
    root: args.root,
    actionRegistry,
    actionDescriptors,
    vizRef,
  });

  const data = createVegaLiteDataBinding({
    spec,
    view,
    options,
    actionRegistry,
    actionDescriptors,
    getHoverFields: tooltip.fields,
  });

  const dataHandles = data.handles;
  const graph = buildGraph({
    spec,
    options,
    actions: actionRegistry.list(),
    dataHandles: dataHandles.map((h) => ({
      ref: h.ref,
      title: h.title,
      description: `DuckDB table for ${h.title}.`,
      data: { tableName: h.tableName, sourceId: h.sourceId },
    })),
  });

  const projection = {
    project: async () => {
      const metadata = new Map(
        await Promise.all(
          dataHandles.map(
            async (handle) =>
              [
                handle.ref,
                await withTimeout(handle.ensureMetadata(), DATA_HANDLE_META_TIMEOUT_MS).catch(() => null),
              ] as const,
          ),
        ),
      );
      const nodes = graph.nodes.map((node) => {
        const meta = metadata.get(node.ref);
        return meta
          ? {
              ...node,
              data: { ...node.data, duckdb: meta },
              description: `DuckDB handle.\n${formatDuckDbTableMetadataSummary(meta)}`,
            }
          : node;
      });

      const state: Record<string, unknown> = {};
      collectVegaLiteParams(spec).forEach((p) => {
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
      dataHandles.forEach((h) => {
        state[h.ref] = {
          kind: 'DataHandle',
          tableName: h.tableName,
          selectionWhere: whereClauseForCurrentSelections(spec, view, h.fields(), tooltip.fields()),
          selectedMeaning: 'rows matching current selection params, falling back to all rows if none',
        };
      });

      const { actions: _actions, ...graphFragment } = graph;
      return { graph: { ...graphFragment, nodes }, state };
    },
  };

  const binding = createVegaLiteObservationBinding({ view, spec, helpers, tooltip });
  return createVacpProvider({
    source: {
      id: sourceId,
      type: 'vega-lite',
      title: options.title ?? options.vizId,
      description: options.description,
    },
    actions: actionRegistry,
    project: projection.project,
    subscribe: binding.subscribe,
    dispose: () => {
      binding.dispose();
      void data.dispose().catch(() => {});
    },
  });
}
