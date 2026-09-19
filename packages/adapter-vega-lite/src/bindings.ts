import type { VacpRef } from '@vacp/protocol';
import { collectVegaLiteParams, selectionMarkTypes } from './params';
import { makeRef } from './refs';
import { signalNamesFromView, tryGetSignal } from './signals';
import type {
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
      read(): unknown;
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
      read: () => readStateSignal(view, param.name) ?? tryGetSignal(view, param.name),
    });
  }
  return { paramByRef, allSignals, rootUnit: typeof spec.name === 'string' ? spec.name : '' };
}
export type VegaLiteBindings = ReturnType<typeof createVegaLiteBindings>;
