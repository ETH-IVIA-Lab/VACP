import type {
  VacpActionCall,
  VacpActionDescriptor,
  VacpCapabilitiesSnapshot,
  VacpChangeSource,
  VacpStateSnapshot,
} from '@vacp/core';
import { nowIso, VACP_SCHEMA_VERSION } from '@vacp/core';
import { applyVacpAttributes, applyVacpInteractionAttributes, embedVacpGraphInSvg } from '@vacp/dom';
import { installVacpRuntimeBridge, registerVacpApplyStateAction, VacpActionRegistry } from '@vacp/gateway';

import { actionsForSpec } from './actions';
import { buildGraph } from './graph';
import { buildParamLookup, executeAction } from './execute';
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

  const graph = buildGraph({ spec, options, actions: actionDescriptors });

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
