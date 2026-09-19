import type { VegaLiteParamLike, VegaLiteSpecLike } from './types.js';

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

/** Selection ownership narrows a datum to the marks that expose that interaction. */
export function selectionMarkTypes(spec: VegaLiteSpecLike): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const visit = (node: VegaLiteSpecLike, inherited: string[]) => {
    const names = [...inherited, ...(node.params ?? []).filter((param) => param.select).map((param) => param.name)];
    const mark = typeof node.mark === 'string' ? node.mark : node.mark?.type;
    const kind =
      typeof mark === 'string'
        ? ((
            { point: 'symbol', circle: 'symbol', square: 'symbol', bar: 'rect', tick: 'rect' } as Record<string, string>
          )[mark] ?? mark)
        : undefined;
    if (kind)
      for (const name of names) {
        const types = result.get(name) ?? new Set<string>();
        types.add(kind);
        result.set(name, types);
      }
    for (const children of [node.layer, node.vconcat, node.hconcat, node.concat, node.spec]) {
      for (const child of Array.isArray(children) ? children : children ? [children] : []) visit(child, names);
    }
  };
  visit(spec, []);
  return result;
}
