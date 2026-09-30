import { readSelectionTuples } from './selection-state';
import { providerBindings } from './provider-bindings';
import {
  vacpDataHandle,
  type VacpActionDescriptor,
  type VacpDataHandleData,
  type VacpProvider,
  type VacpSourceId,
  type VacpRef,
} from '@vacp/protocol';
import { createVacpProvider, registerVacpApplyStateAction, VacpActionRegistry } from '@vacp/runtime';

import { actionsForSpec } from './actions';
import { buildGraph } from './graph';
import { executeVegaLiteActions, prepareVegaLiteAction } from './execute';
import { createVegaLiteDataBinding } from './duckdb-handle';
import { createVegaLiteBindings } from './bindings';
import { makeRef } from './refs';
import type { VegaLiteProviderOptions, VegaLiteSpecLike, VegaViewLike } from './types';

import { createVegaLiteTooltipBinding } from './tooltip';
import { createVegaLiteObservationBinding } from './observe';

/** How long a graph read waits for a data handle's columns before it goes on without them. */
const HANDLE_COLUMNS_TIMEOUT_MS = 1_500;

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

  const helpers = createVegaLiteBindings(spec, view, options);

  const actionDescriptors: VacpActionDescriptor[] = actionsForSpec(options, spec);
  actionDescriptors.forEach((desc) => {
    actionRegistry.register(
      { ...desc, operation: { ...desc.operation, contract: desc.name } },
      async (prepared: ReturnType<typeof prepareVegaLiteAction>) => (await executeVegaLiteActions(view, [prepared]))[0],
      {
        parse: (params) => prepareVegaLiteAction(view, { callId: '', name: desc.name, params }, helpers),
        focus: (prepared) => prepared.focus,
      },
    );
  });

  // Standard action for applying a desired state map through provider refs.
  const vizRef = makeRef({ appId: options.appId, viewId: options.viewId, vizId: options.vizId, suffix: '' });

  const applyDescriptor = registerVacpApplyStateAction(
    actionRegistry,
    (state) => {
      const plans: Array<ReturnType<typeof prepareVegaLiteAction>> = [];
      const skipped: Array<{ ref: string; reason: string }> = [];
      for (const [ref, raw] of Object.entries(state)) {
        const binding = helpers.paramByRef.get(ref as VacpRef);
        if (!binding) {
          skipped.push({ ref, reason: 'State has no parameter restoration operation' });
          continue;
        }
        const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined;
        const hasTuples = binding.kind === 'Selection' && record && Object.hasOwn(record, 'tuples');
        if (hasTuples && !Array.isArray(record.tuples)) throw new Error('Expected captured selection tuples');
        const desired = hasTuples ? record.tuples : record && Object.hasOwn(record, 'value') ? record.value : raw;
        const name =
          binding.kind === 'Param'
            ? 'vega_lite.set_param'
            : desired == null || (typeof desired === 'object' && Object.keys(desired).length === 0)
              ? 'vega_lite.clear_selection'
              : 'vega_lite.set_selection';
        plans.push(
          prepareVegaLiteAction(view, { callId: '', name, params: { ref, value: desired } }, helpers, {
            restore: true,
          }),
        );
      }
      return async ({ signal }) => {
        signal?.throwIfAborted();
        await executeVegaLiteActions(view, plans);
        return { applied: plans.length, skipped };
      };
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
    temporal: helpers.dataflow.temporal,
  });

  const data = createVegaLiteDataBinding({
    spec,
    view,
    bindings: helpers,
    options,
    actionRegistry,
    actionDescriptors,
    getHoverFields: tooltip.fields,
  });

  const dataHandles = data.handles;
  const graph = buildGraph({
    bindings: helpers,
    spec,
    options,
    actions: actionRegistry.list(),
    dataHandles: dataHandles.map((h) => ({
      ref: h.ref,
      title: h.title,
      description: `The rows this chart's marks read from ${h.title}. \`vacp_handle\` narrows them by the current selections and hover, and \`vacp_all\` holds every row the source loaded.`,
      data: { table: h.tableName } satisfies VacpDataHandleData,
    })),
  });

  const projection = {
    project: async () => {
      const handles = new Map(
        await Promise.all(
          dataHandles.map(async (handle) => {
            const { rowCount, columns } = handle.observe();
            const read = {
              ref: handle.ref,
              table: handle.tableName,
              columns: (await withTimeout(columns, HANDLE_COLUMNS_TIMEOUT_MS).catch(() => null)) ?? undefined,
              rowCount,
              selectionWhere: handle.selectionWhere(),
            };
            return [handle.ref, await vacpDataHandle(read, options.describeDataHandle)] as const;
          }),
        ),
      );
      const nodes = graph.nodes.map((node) => {
        const handle = handles.get(node.ref);
        return handle ? { ...node, data: handle.data } : node;
      });

      const state: Record<string, unknown> = {};
      const values = helpers.readValues();
      for (const [ref, { param, kind }] of helpers.paramByRef) {
        state[ref] = param.select
          ? {
              kind,
              name: param.name,
              value: values.get(ref),
              tuples: readSelectionTuples(view, param.name),
              select: param.select,
            }
          : { kind, name: param.name, value: values.get(ref), bind: param.bind };
      }
      for (const [ref, handle] of handles) state[ref] = handle.state;

      const freshness = binding.freshness();
      return { graph: { ...graph, nodes }, state, freshness: freshness ? { [vizRef]: freshness } : undefined };
    },
  };

  const binding = createVegaLiteObservationBinding({ view, helpers, tooltip });
  const provider = createVacpProvider({
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
      providerBindings.delete(provider);
      binding.dispose();
      void data.dispose().catch(() => {});
    },
  });
  providerBindings.set(provider, { bindings: helpers, view, vizRef });
  return provider;
}
