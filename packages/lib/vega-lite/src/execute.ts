import type { VacpActionCall } from '@vacp/core';
import { changeset } from 'vega';

import { signalNamesFromView, tryGetSignal, trySetSignal } from './signals';
import type { VegaLiteParamLike, VegaLiteSpecLike, VegaViewLike } from './types';

function paramNameFromRef(ref: string): string | null {
  const idx = ref.lastIndexOf('/param/');
  if (idx < 0) return null;
  return ref.slice(idx + '/param/'.length);
}

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
  const name = paramNameFromRef(ref);
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
