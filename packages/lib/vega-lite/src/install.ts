import type {
  VacpActionCall,
  VacpActionDescriptor,
  VacpCapabilitiesSnapshot,
  VacpChangeSource,
  VacpRuntimeBridge,
  VacpStateSnapshot,
} from '@vacp/core';
import { nowIso, splitVacpRefAt, VACP_SCHEMA_VERSION } from '@vacp/core';
import { formatDuckDbTableMetadataSummary } from '@vacp/duckdb';
import { installVacpRuntimeBridge, registerVacpApplyStateAction, VacpActionRegistry } from '@vacp/gateway';

import { actionsForSpec } from './actions';
import { buildGraph } from './graph';
import { buildParamLookup, executeAction } from './execute';
import { installVegaLiteDuckDbDataHandles } from './duckdb-handle';
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

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseDateMs(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value !== 'string') return null;
  const s = value.trim();
  // Avoid Date.parse() treating numeric strings (e.g. "11.1") as dates.
  const looksLikeDate = /[a-z]/i.test(s) || s.includes('-') || s.includes('T') || s.includes(':') || s.includes('/');
  if (!looksLikeDate) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function valuesMatch(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  const aDate = parseDateMs(a);
  const bDate = parseDateMs(b);
  if (aDate !== null && bDate !== null) return aDate === bDate;

  const aNum = parseFiniteNumber(a);
  const bNum = parseFiniteNumber(b);
  if (aNum !== null && bNum !== null) return aNum === bNum;

  if (typeof a === 'string' && typeof b === 'string') return a.trim() === b.trim();
  if (typeof a === 'string' && typeof b === 'number') return a.trim() === String(b);
  if (typeof a === 'number' && typeof b === 'string') return String(a) === b.trim();

  return false;
}

function sanitizeHoverValue(value: unknown): unknown {
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
    if (Object.keys(value as Record<string, unknown>).length === 0) return null;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function ensureVegaTooltipDoesNotCapturePointerEvents(): void {
  if (typeof document === 'undefined') return;
  const id = '__vacp_vg_tooltip_style';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = '.vg-tooltip{pointer-events:none !important;}';
  document.head.appendChild(style);
}

function allowedFieldsForHandle(view: VegaViewLike, handleRef: string): Set<string> | null {
  const rec = view as unknown as { __vacpVegaLiteDuckDbFieldsByHandle?: unknown };
  const raw = rec.__vacpVegaLiteDuckDbFieldsByHandle;
  if (!raw || typeof raw !== 'object') return null;
  const list = (raw as Record<string, unknown>)[handleRef];
  if (!Array.isArray(list)) return null;
  const fields = list.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
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
    const raw =
      (datum && Object.prototype.hasOwnProperty.call(datum, field) ? datum[field] : undefined) ??
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
}): VacpRuntimeBridge {
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
    ensureVegaTooltipDoesNotCapturePointerEvents();
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

      const viewAny = view as unknown as { __vacpVegaLiteTooltipHover?: unknown; tooltip?: (handler?: any) => any };
      if (clear) {
        viewAny.__vacpVegaLiteTooltipHover = null;
        // Best-effort: explicitly hide the tooltip via Vega's tooltip handler.
        try {
          if (typeof viewAny.tooltip === 'function') {
            const handler = viewAny.tooltip();
            if (typeof handler === 'function') {
              (view as unknown as { __vacpSuppressTooltipDispatch?: boolean }).__vacpSuppressTooltipDispatch = true;
              handler(
                null,
                new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }),
                null,
                null,
              );
            }
          }
        } catch {
          // ignore
        } finally {
          queueMicrotask(() => {
            (view as unknown as { __vacpSuppressTooltipDispatch?: boolean }).__vacpSuppressTooltipDispatch = false;
          });
        }
        return { cleared: true };
      }

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

          return out;
        }
        return {};
      })();

      viewAny.__vacpVegaLiteTooltipHover = {
        fields,
        markName,
        value: valueParam ?? null,
      };

      // Best-effort: programmatically show the tooltip for a matching mark.
      // This makes playbook-driven "hover" steps visible and stable in the UI.
      let tooltipShown = false;
      try {
        if (typeof viewAny.tooltip !== 'function') return { fields, markName, value: valueParam ?? null, tooltipShown };
        const tooltipHandler = viewAny.tooltip();
        if (typeof tooltipHandler !== 'function') return { fields, markName, value: valueParam ?? null, tooltipShown };

        const target = args.root.querySelector('canvas,svg') as HTMLElement | null;
        const scene = (view as any).scenegraph?.();
        const root = scene?.root;
        if (target && root && Object.keys(fields).length) {
          const matchesDatum = (datum: unknown): boolean => {
            if (!datum || typeof datum !== 'object') return false;
            const d = datum as Record<string, unknown>;
            return Object.entries(fields).every(
              ([k, v]) => Object.prototype.hasOwnProperty.call(d, k) && valuesMatch(d[k], v),
            );
          };

          const seen = new WeakSet<object>();
          let match: any = null;
          const visit = (node: any) => {
            if (!node || typeof node !== 'object') return;
            if (seen.has(node)) return;
            seen.add(node);
            if (match) return;

            const items = node.items;
            if (Array.isArray(items)) {
              for (const it of items) {
                if (match) break;
                if (!it || typeof it !== 'object') continue;
                const datum = (it as any).datum;
                const itMarkName = typeof (it as any)?.mark?.name === 'string' ? ((it as any).mark.name as string) : '';
                const okMark = !markName || itMarkName === markName;
                if (okMark && matchesDatum(datum)) {
                  match = it;
                  break;
                }
                visit(it);
              }
            }
            if (node.group) visit(node.group);
          };
          visit(root);

          const bounds = match?.bounds;
          const x1 = Number(bounds?.x1);
          const y1 = Number(bounds?.y1);
          const x2 = Number(bounds?.x2);
          const y2 = Number(bounds?.y2);
          if (Number.isFinite(x1) && Number.isFinite(y1) && Number.isFinite(x2) && Number.isFinite(y2)) {
            const rect = target.getBoundingClientRect();
            const clientX = rect.left + (x1 + x2) / 2;
            const clientY = rect.top + (y1 + y2) / 2;
            (view as unknown as { __vacpSuppressTooltipDispatch?: boolean }).__vacpSuppressTooltipDispatch = true;
            const tooltipValue = (match as any).tooltip ?? valueParam ?? (Object.keys(fields).length ? fields : null);
            tooltipHandler(
              null,
              new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX, clientY }),
              match,
              tooltipValue,
            );
            tooltipShown = tooltipValue != null;
          }
        }
      } catch {
        // ignore
      } finally {
        queueMicrotask(() => {
          (view as unknown as { __vacpSuppressTooltipDispatch?: boolean }).__vacpSuppressTooltipDispatch = false;
        });
      }

      return { fields, markName, value: valueParam ?? null, tooltipShown };
    });
    actionDescriptors.push(hoverDescriptor);
  }

  const dataHandles = installVegaLiteDuckDbDataHandles({ spec, view, options, actionRegistry, actionDescriptors });
  const handleMetaByRef = new Map<string, import('@vacp/duckdb').VacpDuckDbTableMetadata | null>();

  const graph = buildGraph({
    spec,
    options,
    actions: actionDescriptors,
    dataHandles: dataHandles.map((h) => ({
      ref: h.ref,
      title: h.title,
      description: `DuckDB table for ${h.title}.`,
      data: { tableName: h.tableName, sourceId: h.sourceId },
    })),
  });

  const snapshots = {
    getCapabilities: async (): Promise<VacpCapabilitiesSnapshot> => ({
      version: VACP_SCHEMA_VERSION,
      createdAt: nowIso(),
      graph: await (async () => {
        for (const h of dataHandles) {
          const node = graph.nodes.find((n) => n.kind === 'DataHandle' && n.ref === h.ref) ?? null;
          if (!node) continue;
          if (!handleMetaByRef.has(h.ref)) handleMetaByRef.set(h.ref, await h.ensureMetadata());
          const meta = handleMetaByRef.get(h.ref) ?? null;
          if (!meta) continue;
          (node as any).data = { ...(node as any).data, duckdb: meta };
          (node as any).description = `DuckDB handle for "${h.tableName}".\n${formatDuckDbTableMetadataSummary(meta)}`;
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
      dataHandles.forEach((h) => {
        state[h.ref] = {
          kind: 'DataHandle',
          tableName: h.tableName,
          selectionWhere: whereClauseForCurrentSelections(spec, view, allowedFieldsForHandle(view, h.ref)),
          selectedMeaning: 'rows matching current selection params; falls back to all rows if none',
        };
      });
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
          const suppress = (view as unknown as { __vacpSuppressTooltipDispatch?: boolean })
            .__vacpSuppressTooltipDispatch;
          if (suppress) return original(handler, event, item, value);
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
                  const fields = computeHoverFields({ tooltipInfo, allowed: null, item, value });
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

  return bridge;
}
