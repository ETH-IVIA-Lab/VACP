import type { VacpActionCall } from '@vacp/core';
import { splitVacpRefAt } from '@vacp/core';
import { changeset } from 'vega';

import { collectVegaLiteParams } from './params';
import { signalNamesFromView, tryGetSignal, trySetSignal } from './signals';
import type { VegaLiteParamLike, VegaLiteSpecLike, VegaViewLike } from './types';

function signalsForParam(param: VegaLiteParamLike, allSignals: string[]): string[] {
  // Vega-Lite compiles selection parameters into multiple signals. We can't
  // rely on compile-time knowledge here, so we use best-effort matching:
  // - always include the param name
  // - include any signals that start with the param name (common pattern)
  const out = new Set<string>([param.name]);
  allSignals.forEach((s) => {
    if (s === param.name) return;
    if (s.startsWith(`${param.name}_`)) out.add(s);
  });
  return Array.from(out);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function tryGetSignalValueFromState(view: VegaViewLike, name: string): unknown {
  if (typeof view.getState !== 'function') return undefined;
  try {
    const st = view.getState() as
      | {
          signals?: Record<string, unknown>;
          subcontext?: Record<string, unknown>;
        }
      | undefined;
    if (!st || typeof st !== 'object') return undefined;
    if (st.signals && Object.prototype.hasOwnProperty.call(st.signals, name)) return st.signals[name];

    const stack: unknown[] = [];
    if (st.subcontext && typeof st.subcontext === 'object') {
      stack.push(...Object.values(st.subcontext));
    }

    while (stack.length) {
      const next = stack.pop();
      if (!next || typeof next !== 'object') continue;
      const ctx = next as { signals?: Record<string, unknown>; subcontext?: Record<string, unknown> };
      if (ctx.signals && Object.prototype.hasOwnProperty.call(ctx.signals, name)) return ctx.signals[name];
      if (ctx.subcontext && typeof ctx.subcontext === 'object') {
        stack.push(...Object.values(ctx.subcontext));
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

function bestEffortSelectionTuple(args: {
  selectionValue: unknown;
  tupleFields: unknown;
  unit: unknown;
}): { unit: unknown; fields: unknown[]; values: unknown[] } | null {
  const { selectionValue, tupleFields, unit } = args;

  // Advanced escape hatch: allow callers to pass a store tuple directly.
  if (isRecord(selectionValue) && Array.isArray(selectionValue.fields) && Array.isArray(selectionValue.values)) {
    return {
      unit: selectionValue.unit ?? unit,
      fields: selectionValue.fields,
      values: selectionValue.values,
    };
  }

  if (!isRecord(selectionValue)) return null;
  const fields = Array.isArray(tupleFields) ? (tupleFields as unknown[]) : null;
  if (!fields) return null;

  const values: unknown[] = [];
  for (const f of fields) {
    const rec = isRecord(f) ? f : null;
    const channel = typeof rec?.channel === 'string' ? rec.channel : '';
    const field = typeof rec?.field === 'string' ? rec.field : '';
    const type = typeof rec?.type === 'string' ? rec.type : '';
    const key =
      (channel && Object.prototype.hasOwnProperty.call(selectionValue, channel) && channel) ||
      (field && Object.prototype.hasOwnProperty.call(selectionValue, field) && field) ||
      field ||
      channel;
    let value: unknown = key ? selectionValue[key] : undefined;
    if (type === 'R' && Array.isArray(value) && value.length === 2) {
      const coerce = (v: unknown) => (v instanceof Date ? v.valueOf() : v);
      const a = coerce(value[0]);
      const b = coerce(value[1]);
      value = [a, b];
    } else if (value instanceof Date) {
      value = value.valueOf();
    }
    values.push(value);
  }

  return { unit, fields, values };
}

function tupleFieldKeys(tupleFields: unknown): string[] {
  if (!Array.isArray(tupleFields)) return [];
  return tupleFields.map((f) => {
    const rec = isRecord(f) ? f : null;
    const channel = typeof rec?.channel === 'string' ? rec.channel : '';
    const field = typeof rec?.field === 'string' ? rec.field : '';
    return field || channel;
  });
}

type VegaStateSnapshot =
  | {
      signals?: Record<string, unknown>;
      data?: Record<string, unknown>;
      subcontext?: Record<string, unknown>;
    }
  | undefined;

function signalContextKeyFromSnapshot(snapshot: VegaStateSnapshot, name: string): string | null | undefined {
  if (!snapshot || typeof snapshot !== 'object') return undefined;
  const rootSignals = snapshot.signals;
  if (rootSignals && Object.prototype.hasOwnProperty.call(rootSignals, name)) return null;

  const stack: Array<{ key: string; ctx: unknown }> = [];
  const sub = snapshot.subcontext;
  if (sub && typeof sub === 'object') {
    for (const [key, ctx] of Object.entries(sub)) stack.push({ key, ctx });
  }

  while (stack.length) {
    const { key, ctx } = stack.pop()!;
    if (!ctx || typeof ctx !== 'object') continue;
    const rec = ctx as { signals?: Record<string, unknown>; subcontext?: Record<string, unknown> };
    if (rec.signals && Object.prototype.hasOwnProperty.call(rec.signals, name)) return key;
    if (rec.subcontext && typeof rec.subcontext === 'object') {
      for (const [childKey, childCtx] of Object.entries(rec.subcontext)) stack.push({ key: childKey, ctx: childCtx });
    }
  }

  return undefined;
}

function tryInferUnitIdFromRuntimeSubcontext(view: VegaViewLike, contextKey: string): string | undefined {
  // Vega's `view.getState()` exposes a tree of subcontexts keyed by strings like
  // "0", "1", ... but interval selection tuples encode a Vega-Lite *unit id*
  // (e.g. "concat_0", "layer_2") that matches the subcontext's group mark name
  // without the "_group" suffix.
  //
  // This is intentionally best-effort and guarded: `_runtime` is not part of the
  // public View API, but it's present in Vega's View implementation and is the
  // only reliable way to map subcontext keys → unit ids when the selection is
  // currently empty (tuple signal is null and store is empty).
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rt = (view as any)?._runtime as any;
    const markName = rt?.subcontext?.[contextKey]?.group?.mark?.name;
    if (typeof markName !== 'string' || !markName) return undefined;
    return markName.endsWith('_group') ? markName.slice(0, -'_group'.length) : markName;
  } catch {
    return undefined;
  }
}

function tryGetScaleFn(view: VegaViewLike, name: string): ((v: unknown) => number) | null {
  try {
    const s = view.scale?.(name);
    return typeof s === 'function' ? (s as (v: unknown) => number) : null;
  } catch {
    return null;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

async function applyViewState(view: VegaViewLike, state: unknown): Promise<void> {
  // Prefer an awaited, single-pass `runAsync` to avoid racing `view.setState()`'s
  // internal async run (which does not return a promise).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = view as any;
  if (typeof v.runAsync === 'function' && typeof v?._runtime?.setState === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await v.runAsync(
      null,
      (vv: any) => {
        vv._trigger = false;
        vv._runtime.setState(state);
      },
      (vv: any) => {
        vv._trigger = true;
      },
    );
    return;
  }

  if (typeof view.setState === 'function') view.setState(state);
  await view.runAsync();
}

export function buildParamLookup(spec: VegaLiteSpecLike, view: VegaViewLike) {
  const allSignals = signalNamesFromView(view);
  const paramByName = new Map<string, { param: VegaLiteParamLike; kind: 'Param' | 'Selection' }>();
  const watchedSignalsByParam = new Map<string, string[]>();

  collectVegaLiteParams(spec).forEach((p) => {
    const kind = p.select ? 'Selection' : 'Param';
    paramByName.set(p.name, { param: p, kind });
    watchedSignalsByParam.set(p.name, signalsForParam(p, allSignals));
  });

  return { paramByName, watchedSignalsByParam, allSignals };
}

export async function executeAction(
  view: VegaViewLike,
  call: VacpActionCall,
  helpers: {
    paramByName: Map<string, { param: VegaLiteParamLike; kind: 'Param' | 'Selection' }>;
    watchedSignalsByParam: Map<string, string[]>;
    allSignals: string[];
  },
): Promise<unknown> {
  const params = (call.params ?? {}) as Record<string, unknown>;

  if (call.name === 'vega.set_signal') {
    const name = typeof params.name === 'string' ? params.name : null;
    if (!name) throw new Error('Expected params.name string');
    const ok = trySetSignal(view, name, params.value);
    if (!ok) throw new Error(`Failed to set signal: ${name}`);
    await view.runAsync();
    return { ok: true };
  }

  const ref = typeof params.ref === 'string' ? params.ref : null;
  if (!ref) throw new Error('Expected params.ref string');
  const name = splitVacpRefAt(ref, '/param/')?.after ?? null;
  if (!name) throw new Error(`Could not parse param name from ref: ${ref}`);

  const found = helpers.paramByName.get(name);
  if (!found) throw new Error(`Unknown param: ${name}`);

  if (call.name === 'vega_lite.set_param') {
    if (found.kind !== 'Param') throw new Error(`Param "${name}" is not a variable parameter`);
    const ok = trySetSignal(view, name, params.value);
    if (!ok) throw new Error(`Failed to set param signal: ${name}`);
    await view.runAsync();
    return { ok: true, value: tryGetSignal(view, name) };
  }

  if (call.name === 'vega_lite.set_selection') {
    if (found.kind !== 'Selection') throw new Error(`Param "${name}" is not a selection parameter`);

    const selectionValue = params.value;
    const storeName = `${name}_store`;
    const snapshotBefore = (typeof view.getState === 'function' ? (view.getState() as VegaStateSnapshot) : undefined) as
      | VegaStateSnapshot
      | undefined;

    // Prefer updating the selection store (dataset) so the compiled selection
    // logic (predicates, filters, conditional encodings) sees a coherent state.
    if (typeof view.data === 'function' && typeof view.change === 'function') {
      try {
        const existing = view.data(storeName) as unknown[];
        const tupleFromState = tryGetSignalValueFromState(view, `${name}_tuple`);
        const ctxKey =
          signalContextKeyFromSnapshot(snapshotBefore, `${name}_tuple_fields`) ??
          signalContextKeyFromSnapshot(snapshotBefore, `${name}_tuple`);
        const unitCandidate =
          (isRecord(existing?.[0]) ? (existing[0] as Record<string, unknown>).unit : undefined) ??
          (isRecord(tupleFromState) ? (tupleFromState as Record<string, unknown>).unit : undefined) ??
          tryGetSignalValueFromState(view, `${name}_unit`) ??
          (typeof ctxKey === 'string' ? tryInferUnitIdFromRuntimeSubcontext(view, ctxKey) : undefined);
        const unit = typeof unitCandidate === 'string' ? unitCandidate : undefined;
        const tupleFields =
          tryGetSignalValueFromState(view, `${name}_tuple_fields`) ??
          (isRecord(existing?.[0]) ? (existing[0] as Record<string, unknown>).fields : undefined);

        const values = Array.isArray(selectionValue) ? selectionValue : [selectionValue];
        const keys = tupleFieldKeys(tupleFields);

        const tuples = values
          .map((v) => {
            if (isRecord(v)) return v;
            if (keys.length === 1 && keys[0]) return { [keys[0]]: v };
            return v;
          })
          .map((v) => {
            const tuple = bestEffortSelectionTuple({ selectionValue: v, tupleFields, unit });
            if (!tuple) return null;

            // Some Vega-Lite builds omit the `unit` property entirely for global
            // selections (single-view and some multi-view specs).
            if (tuple.unit === undefined) delete (tuple as { unit?: unknown }).unit;

            return tuple;
          })
          .filter((t): t is NonNullable<typeof t> => !!t);

        if (!tuples.length) throw new Error('Could not build a selection tuple from params.value');

        const cs = changeset().remove(() => true);
        if (tuples.length) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          cs.insert(tuples as any);
        }
        view.change(storeName, cs);
        await view.runAsync();

        // Interval selections draw a brush rectangle using helper signals such
        // as `<name>_x` / `<name>_y` (pixel extents). When we update the store
        // programmatically, those signals don't change, so the rectangle stays
        // invisible even though the selection predicates work. For interval
        // selections that have these helper signals, set them via `setState`.
        const selectDef = found.param.select;
        const isInterval = isRecord(selectDef) && selectDef.type === 'interval';
        if (isInterval && typeof view.getState === 'function') {
          const snapshotAfter = view.getState() as VegaStateSnapshot;
          const next = snapshotAfter;
          const tuple = tuples[0];
          if (next && tuple && Array.isArray(tuple.fields) && Array.isArray(tuple.values)) {
            let touched = 0;
            for (let i = 0; i < tuple.fields.length; i += 1) {
              const f = isRecord(tuple.fields[i]) ? (tuple.fields[i] as Record<string, unknown>) : null;
              const channel = typeof f?.channel === 'string' ? f.channel : null;
              if (channel !== 'x' && channel !== 'y') continue;

              const v = tuple.values[i];
              if (!Array.isArray(v) || v.length !== 2) continue;
              const a = v[0];
              const b = v[1];

              const scale =
                (unit ? tryGetScaleFn(view, `${unit}_${channel}`) : null) ?? tryGetScaleFn(view, channel) ?? null;
              if (!scale) continue;
              const p0 = scale(a);
              const p1 = scale(b);
              if (!isFiniteNumber(p0) || !isFiniteNumber(p1)) continue;

              const signalName = `${name}_${channel}`;
              const loc = signalContextKeyFromSnapshot(next, signalName);
              if (loc === undefined) continue;
              const extent: [number, number] = p0 <= p1 ? [p0, p1] : [p1, p0];

              if (loc === null) {
                if (next.signals && typeof next.signals === 'object') next.signals[signalName] = extent;
                touched += 1;
              } else {
                const ctx = next.subcontext?.[loc];
                const ctxRec = ctx && typeof ctx === 'object' ? (ctx as { signals?: Record<string, unknown> }) : null;
                if (ctxRec?.signals && typeof ctxRec.signals === 'object') {
                  ctxRec.signals[signalName] = extent;
                  touched += 1;
                }
              }
            }

            if (touched) await applyViewState(view, next);
          }
        }

        return { ok: true, method: 'store', value: tryGetSignal(view, name) };
      } catch {
        // Fall back to setting signals below.
      }
    }

    // Best-effort fallback: set the resolved selection signal directly.
    const ok = trySetSignal(view, name, selectionValue);
    if (!ok) throw new Error(`Failed to set selection signal: ${name}`);
    await view.runAsync();
    return { ok: true, method: 'signal', value: tryGetSignal(view, name) };
  }

  if (call.name === 'vega_lite.clear_selection') {
    if (found.kind !== 'Selection') throw new Error(`Param "${name}" is not a selection parameter`);
    // Prefer clearing the Vega-Lite selection *store* (a dataset like
    // `<param>_store`). This avoids mutating internal helper signals such as
    // `<param>_tuple_fields`, which can break subsequent human interaction.
    const storeName = `${name}_store`;
    let cleared = 0;
    if (typeof view.data === 'function' && typeof view.change === 'function') {
      try {
        // Accessing `view.data(name)` throws if the dataset is missing.
        void view.data(storeName);
        view.change(
          storeName,
          changeset().remove(() => true),
        );
        cleared += 1;
      } catch {
        // Fall back below.
      }
    }

    if (!cleared) {
      // Best-effort fallback: clear only the signals that carry tuple/value
      // information. Never clobber `<name>_tuple_fields` (metadata).
      const watched = helpers.watchedSignalsByParam.get(name) ?? [name];
      watched.forEach((sig) => {
        if (helpers.allSignals.length && !helpers.allSignals.includes(sig)) return;
        if (sig.endsWith('_tuple_fields')) return;
        if (sig !== name && !sig.endsWith('_tuple') && !sig.endsWith('_modify')) return;
        if (trySetSignal(view, sig, null)) cleared += 1;
      });
    }
    await view.runAsync();
    return { ok: true, cleared };
  }

  throw new Error(`Unsupported action: ${call.name}`);
}
