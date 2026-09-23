import { selectionTuple, selectionValues, type SelectionTuple } from './selection-state';
import { intervalVisualSignals } from './selection-signals';
import type { VacpActionCall, VacpFocus, VacpRef, VacpInteraction } from '@vacp/protocol';
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
}): SelectionTuple | null {
  const { selectionValue, tupleFields } = args;
  const unit = typeof args.unit === 'string' ? args.unit : undefined;

  const native = selectionTuple(selectionValue, unit);
  if (native) return native;

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

  return selectionTuple({ unit, fields, values });
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

export type PreparedVegaMutation = {
  focus: VacpFocus | undefined;
  visualState?: VegaStateSnapshot;
  write(): void;
  read(): unknown;
};

/** A provider state map is one native evaluation, including all stores and visual helpers. */
export async function executeVegaLiteActions(view: VegaViewLike, plans: readonly PreparedVegaMutation[]) {
  if (!plans.length) return [];
  const states: VegaRuntimeContext[] = [];
  if (plans.some((plan) => plan.visualState) && !view._runtime?.setState)
    throw new Error('Native interval state application is unavailable');
  let failure: { error: unknown } | undefined;
  try {
    for (const plan of plans) {
      plan.write();
      if (plan.visualState) states.push(plan.visualState);
    }
  } catch (error) {
    failure = { error };
  }
  let previousTrigger: boolean | undefined;
  let changedTrigger = false;
  try {
    if (states.length)
      await view.runAsync(null, (native) => {
        previousTrigger = native._trigger;
        changedTrigger = true;
        native._trigger = false;
        for (const state of states) native._runtime!.setState!(state);
      });
    else await view.runAsync();
  } finally {
    if (changedTrigger) view._trigger = previousTrigger;
  }
  if (failure) throw failure.error;
  return plans.map((plan) => plan.read());
}

/** Queue only this interval's visual helpers alongside its store change in one native evaluation. */
function intervalState(
  view: VegaViewLike,
  name: string,
  fields: readonly unknown[],
  values: readonly unknown[] | undefined,
  unit?: string,
): VegaStateSnapshot {
  if (!view.getState) return undefined;
  const visual = intervalVisualSignals(name, fields);
  const names = new Set(visual.values());
  const state = view.getState({
    signals: (signal: string) => names.has(signal),
    data: () => false,
    recurse: true,
  }) as VegaStateSnapshot;
  if (!state) return undefined;
  let touched = false;
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index];
    const channel = isRecord(field) ? field.channel : undefined;
    if (channel !== 'x' && channel !== 'y') continue;
    const signal = visual.get(channel);
    if (!signal) continue;
    const context = findSignalContext(state, signal)?.context;
    if (!context?.signals) continue;
    let pixels = [0, 0];
    if (values) {
      const value = values[index];
      if (!Array.isArray(value) || value.length !== 2) continue;
      const scale = (unit ? tryGetScaleFn(view, `${unit}_${channel}`) : null) ?? tryGetScaleFn(view, channel);
      if (!scale) continue;
      const first = scale(value[0]),
        second = scale(value[1]);
      if (!isFiniteNumber(first) || !isFiniteNumber(second)) continue;
      pixels = first <= second ? [first, second] : [second, first];
    }
    context.signals[signal] = pixels;
    touched = true;
  }
  return touched ? state : undefined;
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
  // One native export serves every signal this preparation reads.
  const signal = (key: string) => findSignalContext(snapshotBefore, key)?.context.signals?.[key];
  const tupleFromState = signal(`${name}_tuple`);

  const ctxKey =
    findSignalContext(snapshotBefore, `${name}_tuple_fields`)?.path ??
    findSignalContext(snapshotBefore, `${name}_tuple`)?.path;

  const unitCandidate =
    (isRecord(existing?.[0]) ? existing[0].unit : undefined) ??
    (isRecord(tupleFromState) ? tupleFromState.unit : undefined) ??
    signal(`${name}_unit`) ??
    (ctxKey?.length ? runtimeUnit(view, ctxKey) : ctxKey ? helpers.rootUnit : undefined);

  const unit = typeof unitCandidate === 'string' ? unitCandidate : undefined;

  const tupleFields = signal(`${name}_tuple_fields`) ?? (isRecord(existing?.[0]) ? existing[0].fields : undefined);

  const values = selectionValues(selectionValue);
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

function interactionForParameter(
  call: VacpActionCall,
  param: { select?: unknown; bind?: unknown },
  fields?: unknown[],
): VacpInteraction {
  if (call.name === 'vega_lite.clear_selection') return { kind: 'activate' };
  const select = isRecord(param.select) ? param.select : undefined;
  if (param.select === 'interval' || select?.type === 'interval') {
    const encodings = Array.isArray(select?.encodings)
      ? select.encodings
      : fields?.map((field) => (isRecord(field) ? field.channel : undefined));
    const x = encodings?.includes('x'),
      y = encodings?.includes('y');
    const axis = x && y ? 'xy' : x ? 'x' : y ? 'y' : undefined;
    return { kind: param.bind === 'scales' ? 'pan' : 'brush', axis };
  }
  const bind = isRecord(param.bind) ? param.bind : undefined;
  if (bind?.input === 'range') return { kind: 'drag', axis: 'x' };
  if (
    bind &&
    ['text', 'number', 'search', 'date', 'datetime-local', 'time', 'email', 'url', 'password'].includes(
      String(bind.input),
    )
  )
    return { kind: 'edit' };
  return { kind: 'activate' };
}

export function prepareVegaLiteAction(
  view: VegaViewLike,
  call: VacpActionCall,
  helpers: VegaLiteBindings,
): PreparedVegaMutation {
  const input = structuredClone(call.params ?? {});
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected action parameters');
  const params = input as Record<string, unknown>;

  if (call.name === 'vega.set_signal') {
    const name = typeof params.name === 'string' ? params.name : null;

    if (!name) throw new Error('Expected params.name string');
    view.signal(name);
    return {
      focus: undefined,
      write: () => {
        if (!trySetSignal(view, name, params.value)) throw new Error(`Failed to set signal: ${name}`);
      },
      read: () => ({ ok: true }),
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
  const store =
    call.name === 'vega_lite.set_selection' ? prepareSelectionStore(view, name, params.value, helpers) : null;
  const definition = found.param.select;
  const interval = definition === 'interval' || (isRecord(definition) && definition.type === 'interval');
  const fields = store?.tuples[0]?.fields ?? readStateSignal(view, `${name}_tuple_fields`);
  const visualState =
    interval && Array.isArray(fields)
      ? intervalState(
          view,
          name,
          fields,
          call.name === 'vega_lite.clear_selection' ? undefined : store?.tuples[0]?.values,
          store?.unit,
        )
      : undefined;
  const focus: VacpFocus = {
    ref: ref as VacpRef,
    detail: { value: params.value },
    interaction: interactionForParameter(call, found.param, store?.tuples[0]?.fields),
  };
  if (call.name === 'vega_lite.set_param' || (call.name === 'vega_lite.set_selection' && !store)) {
    view.signal(name);
    return {
      focus,
      write: () => {
        if (!trySetSignal(view, name, params.value)) throw new Error(`Failed to set parameter signal: ${name}`);
      },
      read: () => ({
        ok: true,
        ...(call.name === 'vega_lite.set_selection' ? { method: 'signal' } : {}),
        value: tryGetSignal(view, name),
      }),
    };
  }
  if (store)
    return {
      focus,
      visualState,
      write: () => {
        view.change!(
          store.storeName,
          changeset()
            .remove(() => true)
            .insert(store.tuples),
        );
      },
      read: () => ({ ok: true, method: 'store', value: tryGetSignal(view, name) }),
    };

  // Resolve the clear route during preparation; native failures never trigger a second mutation route.
  const storeName = `${name}_store`;
  let hasStore = false;
  if (view.data && view.change) {
    try {
      view.data(storeName);
      hasStore = true;
    } catch {
      /* This source exposes only signals. */
    }
  }
  const signals = hasStore
    ? []
    : found.signals.filter((signal) => {
        if (helpers.allSignals.length && !helpers.allSignals.includes(signal)) return false;
        if (signal !== name && !signal.endsWith('_tuple') && !signal.endsWith('_modify')) return false;
        try {
          view.signal(signal);
          return true;
        } catch {
          return false;
        }
      });
  return {
    focus,
    visualState,
    write: () => {
      if (hasStore)
        view.change!(
          storeName,
          changeset().remove(() => true),
        );
      else
        for (const signal of signals) {
          if (!trySetSignal(view, signal, null)) throw new Error(`Failed to clear selection signal: ${signal}`);
        }
    },
    read: () => ({ ok: true, cleared: hasStore ? 1 : signals.length }),
  };
}
