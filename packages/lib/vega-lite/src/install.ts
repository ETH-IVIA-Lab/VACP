import type {
  VacpActionCall,
  VacpActionDescriptor,
  VacpCapabilitiesSnapshot,
  VacpChangeSource,
  VacpStateSnapshot,
} from '@vacp/core';
import { nowIso, splitVacpRefAt, VACP_SCHEMA_VERSION } from '@vacp/core';
import { formatDuckDbTableMetadataSummary } from '@vacp/duckdb';
import { installVacpRuntimeBridge, registerVacpApplyStateAction, VacpActionRegistry } from '@vacp/gateway';

import { actionsForSpec } from './actions';
import { buildGraph } from './graph';
import { buildParamLookup, executeAction } from './execute';
import { installVegaLiteDuckDbDataHandle } from './duckdb-handle';
import { whereClauseForCurrentSelections } from './duckdb-selection';
import { collectVegaLiteParams } from './params';
import { makeRef } from './refs';
import { tryGetSignal } from './signals';
import type { InstallVacpOnVegaLiteOptions, VegaLiteSpecLike, VegaViewLike } from './types';

const VEGA_LITE_TOOLTIP_HOVER_ACTION = 'vega_lite.hover_tooltip';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

type TooltipFieldInfo = {
  fields: Set<string>;
  titleToField: Map<string, string>;
};

function specHasTooltip(spec: VegaLiteSpecLike): boolean {
  const encoding = spec.encoding;
  if (isRecord(encoding) && encoding.tooltip != null) return true;

  const mark = spec.mark;
  if (isRecord(mark) && (mark as Record<string, unknown>).tooltip != null) return true;

  const children: unknown[] = [];
  if (Array.isArray(spec.layer)) children.push(...spec.layer);
  if (Array.isArray(spec.hconcat)) children.push(...spec.hconcat);
  if (Array.isArray(spec.vconcat)) children.push(...spec.vconcat);
  if (Array.isArray(spec.concat)) children.push(...spec.concat);
  if (spec.spec) children.push(spec.spec);

  for (const child of children) {
    if (!child || typeof child !== 'object') continue;
    if (specHasTooltip(child as VegaLiteSpecLike)) return true;
  }

  return false;
}

function collectTooltipFieldInfo(spec: VegaLiteSpecLike): TooltipFieldInfo {
  const fields = new Set<string>();
  const titleToField = new Map<string, string>();

  const visitTooltip = (tooltip: unknown) => {
    if (tooltip === null || tooltip === undefined) return;
    if (typeof tooltip === 'string') {
      fields.add(tooltip);
      return;
    }
    if (Array.isArray(tooltip)) {
      tooltip.forEach(visitTooltip);
      return;
    }
    if (!isRecord(tooltip)) return;

    const field = typeof tooltip.field === 'string' ? tooltip.field : null;
    const title = typeof tooltip.title === 'string' ? tooltip.title : null;
    if (field) fields.add(field);
    if (field && title && !titleToField.has(title)) titleToField.set(title, field);
  };

  const walk = (s: VegaLiteSpecLike) => {
    const enc = s.encoding;
    if (isRecord(enc) && enc.tooltip != null) visitTooltip(enc.tooltip);

    const children: unknown[] = [];
    if (Array.isArray(s.layer)) children.push(...s.layer);
    if (Array.isArray(s.hconcat)) children.push(...s.hconcat);
    if (Array.isArray(s.vconcat)) children.push(...s.vconcat);
    if (Array.isArray(s.concat)) children.push(...s.concat);
    if (s.spec) children.push(s.spec);

    for (const child of children) {
      if (!child || typeof child !== 'object') continue;
      walk(child as VegaLiteSpecLike);
    }
  };

  walk(spec);
  return { fields, titleToField };
}

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sanitizeHoverValue(value: unknown): unknown {
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
    if (Object.keys(value as Record<string, unknown>).length === 0) return null;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function allowedFieldsFromView(view: VegaViewLike): Set<string> | null {
  const rec = view as unknown as { __vacpVegaLiteDuckDbFields?: unknown };
  const raw = rec.__vacpVegaLiteDuckDbFields;
  if (!Array.isArray(raw)) return null;
  const fields = raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  return fields.length ? new Set(fields) : null;
}

function computeHoverFields(args: {
  tooltipInfo: TooltipFieldInfo;
  allowed: Set<string> | null;
  item: unknown;
  value: unknown;
}): Record<string, unknown> {
  const datum = isRecord((args.item as any)?.datum) ? ((args.item as any).datum as Record<string, unknown>) : null;
  const tooltipValue = isRecord(args.value) ? (args.value as Record<string, unknown>) : null;
  const out: Record<string, unknown> = {};

  args.tooltipInfo.fields.forEach((field) => {
    const raw = (datum && Object.prototype.hasOwnProperty.call(datum, field) ? datum[field] : undefined) ??
      (tooltipValue && Object.prototype.hasOwnProperty.call(tooltipValue, field) ? tooltipValue[field] : undefined);
    const sanitized = sanitizeHoverValue(raw);
    if (sanitized === null || sanitized === undefined) return;
    if (args.allowed && !args.allowed.has(field)) return;
    out[field] = sanitized;
  });

  if (tooltipValue) {
    for (const [title, field] of args.tooltipInfo.titleToField.entries()) {
      if (args.allowed && !args.allowed.has(field)) continue;
      if (Object.prototype.hasOwnProperty.call(out, field)) continue;
      if (!Object.prototype.hasOwnProperty.call(tooltipValue, title)) continue;
      const sanitized = sanitizeHoverValue(tooltipValue[title]);
      if (sanitized === null || sanitized === undefined) continue;
      out[field] = sanitized;
    }
  }

  // Last resort: if we still have no predicates but we know the DuckDB columns,
  // pick any overlapping datum fields so `vacp_handle` can still resemble focus.
  if (!Object.keys(out).length && datum && args.allowed) {
    for (const field of args.allowed) {
      if (!Object.prototype.hasOwnProperty.call(datum, field)) continue;
      const sanitized = sanitizeHoverValue(datum[field]);
      if (sanitized === null || sanitized === undefined) continue;
      out[field] = sanitized;
    }
  }

  return out;
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
export function installVacpOnVegaLiteView(args: {
  root: HTMLElement;
  view: VegaViewLike;
  spec: VegaLiteSpecLike;
  options: InstallVacpOnVegaLiteOptions;
}): void {
  const { view, spec, options } = args;

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
        const name = splitVacpRefAt(ref, '/param/')?.after ?? null;
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

  const hasTooltip = specHasTooltip(spec);
  if (hasTooltip) {
    const tooltipInfo = collectTooltipFieldInfo(spec);
    const hoverDescriptor: VacpActionDescriptor = {
      name: VEGA_LITE_TOOLTIP_HOVER_ACTION,
      description:
        'Set the current tooltip-hover focus for this Vega-Lite view (enables agents to treat hovered points as an explicit selection).',
      targetRef: vizRef,
      parameters: {
        type: 'object',
        properties: {
          clear: { type: 'boolean', description: 'If true, clear the current hover focus.' },
          fields: {
            type: 'object',
            description: 'Field→value map to treat as the hovered/selected datum (preferred).',
          },
          value: { description: 'Tooltip payload from Vega (optional; useful for UI/debugging).' },
          markName: { type: 'string', description: 'Vega mark name, if available.' },
        },
      },
    };
    actionRegistry.register(hoverDescriptor, async (params) => {
      const p = isRecord(params) ? params : {};
      const clear = p.clear === true;
      const fieldsParam = p.fields;
      const valueParam = p.value;
      const markName = typeof p.markName === 'string' ? p.markName : '';

      const viewAny = view as unknown as { __vacpVegaLiteTooltipHover?: unknown };
      if (clear) {
        viewAny.__vacpVegaLiteTooltipHover = null;
        return { cleared: true };
      }

      const allowed = allowedFieldsFromView(view);

      const fields: Record<string, unknown> = (() => {
        if (isRecord(fieldsParam)) {
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(fieldsParam)) {
            if (!k) continue;
            const sanitized = sanitizeHoverValue(v);
            if (sanitized === null || sanitized === undefined) continue;
            out[k] = sanitized;
          }
          return out;
        }
        if (isRecord(valueParam)) {
          const v = valueParam as Record<string, unknown>;
          const out: Record<string, unknown> = {};
          for (const [k, raw] of Object.entries(v)) {
            const field = tooltipInfo.titleToField.get(k) ?? (tooltipInfo.fields.has(k) ? k : null);
            if (!field) continue;
            const sanitized = sanitizeHoverValue(raw);
            if (sanitized === null || sanitized === undefined) continue;
            out[field] = sanitized;
          }

          // If we still have no overlap with the DuckDB table, try a last-resort
          // heuristic: keep any fields that match a known column name.
          if (allowed) {
            const filtered = Object.fromEntries(Object.entries(out).filter(([k]) => allowed.has(k)));
            if (Object.keys(filtered).length) return filtered;
          }

          return out;
        }
        return {};
      })();

      const effectiveFields =
        allowed && Object.keys(fields).length ? Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.has(k))) : fields;

      viewAny.__vacpVegaLiteTooltipHover = {
        fields: effectiveFields,
        markName,
        value: valueParam ?? null,
      };

      return { fields: effectiveFields, markName, value: valueParam ?? null };
    });
    actionDescriptors.push(hoverDescriptor);
  }

  const dataHandle = installVegaLiteDuckDbDataHandle({ spec, view, options, actionRegistry, actionDescriptors });
  const handleRef = dataHandle?.ref ?? null;
  const tableName = dataHandle?.tableName ?? null;
  let handleMeta: import('@vacp/duckdb').VacpDuckDbTableMetadata | null = null;

  const graph = buildGraph({
    spec,
    options,
    actions: actionDescriptors,
    dataHandle: handleRef && tableName ? { ref: handleRef, data: { tableName } } : undefined,
  });

  const dataHandleNode =
    handleRef && tableName ? graph.nodes.find((n) => n.kind === 'DataHandle' && n.ref === handleRef) : null;

  const snapshots = {
    getCapabilities: async (): Promise<VacpCapabilitiesSnapshot> => ({
      version: VACP_SCHEMA_VERSION,
      createdAt: nowIso(),
      graph: await (async () => {
        if (dataHandle && dataHandleNode && !handleMeta) {
          handleMeta = await dataHandle.ensureMetadata();
          if (handleMeta) {
            (dataHandleNode as any).data = { ...(dataHandleNode as any).data, duckdb: handleMeta };
            (dataHandleNode as any).description =
              `DuckDB handle for "${tableName}".\n${formatDuckDbTableMetadataSummary(handleMeta)}`;
          }
        }
        return graph;
      })(),
    }),
    getState: async (): Promise<VacpStateSnapshot> => {
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
    playbooks: options.playbooks,
    globalKey: options.globalKey,
    sessionKey: `${options.viewId}/${options.vizId}`,
  });

  // Record tooltip hovers as explicit "human" actions in the runtime timeline.
  if (hasTooltip) {
    const viewAny = view as unknown as { __vacpTooltipHoverInstalled?: boolean; tooltip?: (handler?: any) => any };
    if (!viewAny.__vacpTooltipHoverInstalled && typeof viewAny.tooltip === 'function') {
      viewAny.__vacpTooltipHoverInstalled = true;
      const original = viewAny.tooltip();
      if (typeof original === 'function') {
        const tooltipInfo = collectTooltipFieldInfo(spec);
        let lastKey: string | null = null;
        let dispatchChain: Promise<unknown> = Promise.resolve();

        const wrapped = (handler: any, event: MouseEvent, item: any, value: any) => {
          try {
            if (value == null || value === '') {
              lastKey = null;
              (view as unknown as { __vacpVegaLiteTooltipHover?: unknown }).__vacpVegaLiteTooltipHover = null;
            } else {
              const markName = typeof item?.mark?.name === 'string' ? (item.mark.name as string) : '';
              const key = `${markName}|${stableJson(value)}`;
              if (key !== lastKey) {
                lastKey = key;
                if (typeof bridge.dispatch === 'function') {
                  const allowed = allowedFieldsFromView(view);
                  const fields = computeHoverFields({ tooltipInfo, allowed, item, value });
                  const call: VacpActionCall = {
                    callId: crypto.randomUUID(),
                    name: VEGA_LITE_TOOLTIP_HOVER_ACTION,
                    params: { value, markName, fields },
                  };
                  dispatchChain = dispatchChain
                    .then(() => bridge.dispatch?.(call, { source: 'human', message: 'tooltip hover' }))
                    .catch(() => {});
                }
              }
            }
          } catch {
            // ignore
          }
          return original(handler, event, item, value);
        };

        try {
          viewAny.tooltip(wrapped);
        } catch {
          // ignore
        }
      }
    }
  }

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
    collectVegaLiteParams(spec).forEach((p) => {
      (helpers.watchedSignalsByParam.get(p.name) ?? [p.name]).forEach((s) => watched.add(s));
    });
    watched.forEach((s) => view.addSignalListener?.(s, onSignal));
  }
}
