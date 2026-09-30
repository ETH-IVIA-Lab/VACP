import type { VacpRef } from '@vacp/protocol';
import { vegaLiteDataflow } from './dataflow';
import { collectVegaLiteParams, selectionMarkTypes } from './params';
import { makeRef } from './refs';
import { signalNamesFromView, tryGetSignal } from './signals';
import type {
  VegaScaleLike,
  VegaLiteParamLike,
  VegaLiteSpecLike,
  VegaLiteProviderOptions,
  VegaViewLike,
  VegaRuntimeContext,
} from './types';

/** Shared traversal for serialized state and native runtime scopes. Paths retain nested unit identity. */
function* contexts(
  context: VegaRuntimeContext | undefined,
  path: string[] = [],
): Generator<{ context: VegaRuntimeContext; path: string[] }> {
  if (!context) return;
  yield { context, path };
  for (const [key, child] of Object.entries(context.subcontext ?? {})) yield* contexts(child, [...path, key]);
}

export function findSignalContext(state: VegaRuntimeContext | undefined, name: string) {
  for (const entry of contexts(state)) if (Object.hasOwn(entry.context.signals ?? {}, name)) return entry;
  return undefined;
}

export function readStateSignal(view: VegaViewLike, name: string): unknown {
  try {
    return findSignalContext(view.getState?.() as VegaRuntimeContext | undefined, name)?.context.signals?.[name];
  } catch {
    return undefined;
  }
}

export function runtimeUnit(view: VegaViewLike, path: string[]): string | undefined {
  let context = view._runtime;
  for (const key of path) context = context?.subcontext?.[key];
  const name = context?.group?.mark?.name;
  return name?.replace(/_group$/, '');
}

function selectionContexts(view: VegaViewLike, name: string) {
  return [...contexts(view._runtime)].flatMap(({ context }) =>
    Object.hasOwn(context.signals ?? {}, `${name}_tuple_fields`) ? [context] : [],
  );
}

export function createVegaLiteBindings(spec: VegaLiteSpecLike, view: VegaViewLike, options: VegaLiteProviderOptions) {
  const allSignals = signalNamesFromView(view);
  const ownedMarks = selectionMarkTypes(spec);
  const paramByRef = new Map<
    VacpRef,
    {
      param: VegaLiteParamLike;
      kind: 'Param' | 'Selection';
      signals: string[];
      markTypes?: ReadonlySet<string>;
      contexts(): VegaRuntimeContext[];
    }
  >();
  for (const param of collectVegaLiteParams(spec)) {
    const signals = new Set(allSignals.length === 0 || allSignals.includes(param.name) ? [param.name] : []);
    for (const name of allSignals) if (name.startsWith(`${param.name}_`)) signals.add(name);
    paramByRef.set(makeRef({ ...options, suffix: `/param/${param.name}` }), {
      param,
      kind: param.select ? 'Selection' : 'Param',
      signals: [...signals],
      markTypes: ownedMarks.get(param.name),
      contexts: () => selectionContexts(view, param.name),
    });
  }
  const scale = (name: string) => {
    try {
      return view.scale?.(name) as VegaScaleLike | undefined;
    } catch {
      return undefined;
    }
  };
  const dataflow = vegaLiteDataflow(spec);
  return {
    paramByRef,
    allSignals,
    rootUnit: typeof spec.name === 'string' ? spec.name : '',
    dataflow,
    /** Fields Vega holds as instants, with the clock their axis reads. */
    temporal: dataflow.temporal,
    /** The scale behind a channel, in the unit's own scope when the chart has several. */
    scale: (unit: string | undefined, channel: string) =>
      (unit ? scale(`${unit}_${channel}`) : undefined) ?? scale(channel),
    /** A dataset's rows as they entered it, before its own transforms. */
    datasetInput(name: string): unknown[] | null {
      const input = view._runtime?.data?.[name];
      const value =
        input && typeof input === 'object' ? (input as { input?: { value?: unknown } }).input?.value : undefined;
      return Array.isArray(value) ? value : null;
    },
    readValues() {
      let state: VegaRuntimeContext | undefined;
      try {
        state = view.getState?.() as VegaRuntimeContext | undefined;
      } catch {
        /* Native signal reads remain available when snapshot export is unavailable. */
      }
      const signals = new Map<string, unknown>();
      for (const { context } of contexts(state)) {
        for (const [name, value] of Object.entries(context.signals ?? {}))
          if (!signals.has(name)) signals.set(name, value);
      }
      const values = new Map<VacpRef, unknown>();
      for (const [ref, { param }] of paramByRef)
        values.set(ref, signals.get(param.name) ?? tryGetSignal(view, param.name));
      return values;
    },
  };
}
export type VegaLiteBindings = ReturnType<typeof createVegaLiteBindings>;
