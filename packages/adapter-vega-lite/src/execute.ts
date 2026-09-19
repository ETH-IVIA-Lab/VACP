import { intervalVisualSignals } from './selection-signals';
import type { VacpActionCall, VacpFocus, VacpRef } from '@vacp/protocol';
import { changeset } from 'vega';

import { findSignalContext, readStateSignal, runtimeUnit, type VegaLiteBindings } from './bindings';
import { tryGetSignal, trySetSignal } from './signals';
import type { VegaViewLike, VegaRuntimeContext } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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
  const fields = Array.isArray(tupleFields) ? tupleFields : null;

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

type VegaStateSnapshot = VegaRuntimeContext | undefined;

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
  const v = view;

  if (typeof v.runAsync === 'function' && typeof v?._runtime?.setState === 'function') {
    await v.runAsync(
      null,
      (vv) => {
        vv._trigger = false;
        vv._runtime?.setState?.(state);
      },
      (vv) => {
        vv._trigger = true;
      },
    );

    return;
  }

  if (typeof view.setState === 'function') view.setState(state);
  await view.runAsync();
}

function prepareSelectionStore(view: VegaViewLike, name: string, selectionValue: unknown, helpers: VegaLiteBindings) {
  if (!view.data || !view.change) return null;
  const storeName = `${name}_store`;
  const snapshotBefore = view.getState?.() as VegaStateSnapshot;
  let existing: unknown[];
  try {
    existing = view.data!(storeName) as unknown[];
  } catch {
    return null;
  }
  const tupleFromState = readStateSignal(view, `${name}_tuple`);

  const ctxKey =
    findSignalContext(snapshotBefore, `${name}_tuple_fields`)?.path ??
    findSignalContext(snapshotBefore, `${name}_tuple`)?.path;

  const unitCandidate =
    (isRecord(existing?.[0]) ? existing[0].unit : undefined) ??
    (isRecord(tupleFromState) ? tupleFromState.unit : undefined) ??
    readStateSignal(view, `${name}_unit`) ??
    (ctxKey?.length ? runtimeUnit(view, ctxKey) : ctxKey ? helpers.rootUnit : undefined);

  const unit = typeof unitCandidate === 'string' ? unitCandidate : undefined;

  const tupleFields =
    readStateSignal(view, `${name}_tuple_fields`) ?? (isRecord(existing?.[0]) ? existing[0].fields : undefined);

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
      if (tuple.unit === undefined) delete tuple.unit;

      return tuple;
    })
    .filter((t): t is NonNullable<typeof t> => !!t);

  if (!tuples.length) throw new Error('Could not build a selection tuple from params.value');

  return { storeName, tuples, unit };
}

export function prepareVegaLiteAction(view: VegaViewLike, call: VacpActionCall, helpers: VegaLiteBindings) {
  const input = structuredClone(call.params ?? {});
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected action parameters');
  const params = input as Record<string, unknown>;

  if (call.name === 'vega.set_signal') {
    const name = typeof params.name === 'string' ? params.name : null;

    if (!name) throw new Error('Expected params.name string');
    view.signal(name);
    return {
      focus: undefined,
      execute: async () => {
        const ok = trySetSignal(view, name, params.value);

        if (!ok) throw new Error(`Failed to set signal: ${name}`);
        await view.runAsync();

        return { ok: true };
      },
    };
  }

  const ref = typeof params.ref === 'string' ? params.ref : null;

  if (!ref) throw new Error('Expected params.ref string');
  const found = helpers.paramByRef.get(ref as VacpRef);
  if (!found) throw new Error(`Unknown parameter reference: ${ref}`);
  const name = found.param.name;

  if (call.name === 'vega_lite.set_param' && found.kind !== 'Param')
    throw new Error(`Param "${name}" is not a variable parameter`);
  if (call.name !== 'vega_lite.set_param' && found.kind !== 'Selection')
    throw new Error(`Param "${name}" is not a selection parameter`);
  if (!['vega_lite.set_param', 'vega_lite.set_selection', 'vega_lite.clear_selection'].includes(call.name))
    throw new Error(`Unsupported action: ${call.name}`);
  const focus: VacpFocus = { ref: ref as VacpRef, detail: { value: params.value } };
  const store =
    call.name === 'vega_lite.set_selection' ? prepareSelectionStore(view, name, params.value, helpers) : null;
  return {
    focus,
    execute: async () => {
      if (call.name === 'vega_lite.set_param') {
        const ok = trySetSignal(view, name, params.value);

        if (!ok) throw new Error(`Failed to set param signal: ${name}`);
        await view.runAsync();

        return { ok: true, value: tryGetSignal(view, name) };
      }

      if (call.name === 'vega_lite.set_selection') {
        const selectionValue = params.value;
        if (store) {
          const { storeName, tuples, unit } = store;
          const cs = changeset().remove(() => true);

          if (tuples.length) {
            cs.insert(tuples);
          }

          view.change!(storeName, cs);
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
              const visualSignals = intervalVisualSignals(name, tuple.fields);

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

                const signalName = visualSignals.get(channel);
                if (!signalName) continue;
                const context = findSignalContext(next, signalName)?.context;
                if (!context?.signals) continue;
                context.signals[signalName] = p0 <= p1 ? [p0, p1] : [p1, p0];
                touched += 1;
              }

              if (touched) await applyViewState(view, next);
            }
          }

          return { ok: true, method: 'store', value: tryGetSignal(view, name) };
        }

        // Sources without a selection store expose the resolved signal directly.
        const ok = trySetSignal(view, name, selectionValue);

        if (!ok) throw new Error(`Failed to set selection signal: ${name}`);
        await view.runAsync();

        return { ok: true, method: 'signal', value: tryGetSignal(view, name) };
      }

      if (call.name === 'vega_lite.clear_selection') {
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
          const watched = found.signals;
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
    },
  };
}
