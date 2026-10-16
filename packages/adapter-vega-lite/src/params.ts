import type { VegaLiteParamLike, VegaLiteSpecLike } from './types';

export function* specUnits(
  spec: VegaLiteSpecLike,
  path = 'root',
  inherited: string[] = [],
  inheritedMark?: string,
): Generator<{
  spec: VegaLiteSpecLike;
  path: string;
  markType: string | undefined;
  params: VegaLiteParamLike[];
  selections: string[];
}> {
  const params = (spec.params ?? []).filter((param) => typeof param.name === 'string' && param.name.length);
  const selections = [...inherited, ...params.filter((param) => param.select).map((param) => param.name)];
  const markType = typeof spec.mark === 'string' ? spec.mark : (spec.mark?.type ?? inheritedMark);
  yield { spec, path, markType, params, selections };
  for (const key of ['layer', 'hconcat', 'vconcat', 'concat'] as const)
    for (const [index, child] of (spec[key] ?? []).entries())
      yield* specUnits(child, `${path}/${key}[${index}]`, selections, markType);
  if (spec.spec) yield* specUnits(spec.spec, `${path}/spec`, selections, markType);
}

export function collectVegaLiteParams(spec: VegaLiteSpecLike): VegaLiteParamLike[] {
  const params = new Map<string, VegaLiteParamLike>();
  for (const unit of specUnits(spec))
    for (const param of unit.params) if (!params.has(param.name)) params.set(param.name, param);
  return [...params.values()];
}

export function selectionMarkTypes(spec: VegaLiteSpecLike): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const kinds: Record<string, string> = {
    point: 'symbol',
    circle: 'symbol',
    square: 'symbol',
    bar: 'rect',
    tick: 'rect',
  };
  for (const unit of specUnits(spec)) {
    if (!unit.markType) continue;
    for (const name of unit.selections) {
      const types = result.get(name) ?? new Set<string>();
      types.add(kinds[unit.markType] ?? unit.markType);
      result.set(name, types);
    }
  }
  return result;
}

export function encodingField(spec: VegaLiteSpecLike, channel: string): string | null {
  for (const unit of specUnits(spec)) {
    const field = unit.spec.encoding?.[channel];
    if (field && typeof field.field === 'string') return field.field;
    for (const condition of [field?.condition].flat())
      if (condition && typeof condition.field === 'string') return condition.field;
  }
  return null;
}
