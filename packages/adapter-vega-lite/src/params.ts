import type { VegaLiteParamLike, VegaLiteSpecLike } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isVegaLiteParamLike(value: unknown): value is VegaLiteParamLike {
  if (!isRecord(value)) return false;

  return typeof value.name === 'string' && value.name.length > 0;
}

/**
 * Collect all Vega-Lite `params` from a spec, including params nested under
 * `layer`, `vconcat`, `hconcat`, `concat`, and `spec`.
 *
 * Vega-Lite allows defining selection params at the unit-spec level (e.g. inside
 * a single layer or a vconcat child). Those params still compile into global
 * Vega signals, so they are valid VACP control/state surfaces.
 */
export function collectVegaLiteParams(spec: VegaLiteSpecLike): VegaLiteParamLike[] {
  const byName = new Map<string, VegaLiteParamLike>();
  const stack: unknown[] = [spec];

  while (stack.length) {
    const next = stack.pop();

    if (!isRecord(next)) continue;

    const params = next.params;

    if (Array.isArray(params)) {
      for (const p of params) {
        if (!isVegaLiteParamLike(p)) continue;

        if (!byName.has(p.name)) byName.set(p.name, p);
      }
    }

    const pushChild = (child: unknown): void => {
      if (!child) return;

      if (Array.isArray(child)) stack.push(...child);
      else if (isRecord(child)) stack.push(child);
    };

    pushChild(next.layer);
    pushChild(next.vconcat);
    pushChild(next.hconcat);
    pushChild(next.concat);
    pushChild(next.spec);
  }

  return Array.from(byName.values());
}
