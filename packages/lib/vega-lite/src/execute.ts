import type { VacpActionCall } from '@vacp/core';
import { splitVacpRefAt } from '@vacp/core';
import { changeset } from 'vega';

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
    const key =
      (typeof rec?.field === 'string' && rec.field) || (typeof rec?.channel === 'string' && rec.channel) || '';
    values.push(key ? selectionValue[key] : undefined);
  }

  return { unit, fields, values };
}

function tupleFieldKeys(tupleFields: unknown): string[] {
  if (!Array.isArray(tupleFields)) return [];
  return tupleFields.map((f) => {
    const rec = isRecord(f) ? f : null;
    const key =
      (typeof rec?.field === 'string' && rec.field) || (typeof rec?.channel === 'string' && rec.channel) || '';
    return key;
  });
}

export function buildParamLookup(spec: VegaLiteSpecLike, view: VegaViewLike) {
  const allSignals = signalNamesFromView(view);
  const paramByName = new Map<string, { param: VegaLiteParamLike; kind: 'Param' | 'Selection' }>();
  const watchedSignalsByParam = new Map<string, string[]>();

  (spec.params ?? []).forEach((p) => {
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

    // Prefer updating the selection store (dataset) so the compiled selection
    // logic (predicates, filters, conditional encodings) sees a coherent state.
    if (typeof view.data === 'function' && typeof view.change === 'function') {
      try {
        const existing = view.data(storeName) as unknown[];
        const unit =
          (isRecord(existing?.[0]) ? (existing[0] as Record<string, unknown>).unit : undefined) ??
          tryGetSignalValueFromState(view, `${name}_unit`);
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
        view.change(
          storeName,
          cs,
        );
        await view.runAsync();
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
