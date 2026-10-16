import type { VegaViewLike } from './types';

export type VegaSceneItem = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  bounds?: { x1: number; y1: number; x2: number; y2: number };
  datum?: Record<string, unknown>;
  tooltip?: unknown;
  items?: VegaSceneItem[];
  mark?: { name?: string; marktype?: string; group?: VegaSceneItem };
};

function* sceneItems(view: VegaViewLike): Generator<VegaSceneItem> {
  const graph = view.scenegraph() as { root?: VegaSceneItem } | undefined;
  if (!graph?.root) return;
  const stack = [graph.root];
  while (stack.length) {
    const item = stack.pop()!;
    yield item;
    if (item.items) for (let i = item.items.length - 1; i >= 0; i--) stack.push(item.items[i]!);
  }
}

/** Bounds live in the parent group's coordinates. Accumulate every enclosing group. */
export function sceneOffset(item: VegaSceneItem | undefined): { x: number; y: number } {
  let x = 0,
    y = 0;
  for (let group = item; group; group = group.mark?.group) {
    x += group.x ?? 0;
    y += group.y ?? 0;
  }
  return { x, y };
}

/** Convert scene coordinates using Vega's renderer origin and CSS viewport transform. */
export function scenePointToViewport(view: VegaViewLike, target: Element, point: { x: number; y: number }) {
  const origin = view.origin();
  const padding = view.padding();
  const x = point.x + (origin[0] ?? 0) + (typeof padding === 'number' ? padding : (padding?.left ?? 0));
  const y = point.y + (origin[1] ?? 0) + (typeof padding === 'number' ? padding : (padding?.top ?? 0));
  if (target.tagName.toLowerCase() === 'svg') {
    const matrix = (target as SVGGraphicsElement).getScreenCTM();
    return matrix ? { x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f } : null;
  }
  const rect = target.getBoundingClientRect();
  const width = target.clientWidth,
    height = target.clientHeight;
  if (!width || !height) return null;
  return { x: rect.x + (x * rect.width) / width, y: rect.y + (y * rect.height) / height };
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  if (typeof value !== 'string') return null;
  const n = Number(value);

  return Number.isFinite(n) ? n : null;
}

/**
 * A datum value against a requested one. Requested values for temporal fields arrive as instants, so
 * a Date datum compares by its instant. Numbers compare numerically and text compares trimmed.
 */
function valuesMatch(datum: unknown, requested: unknown): boolean {
  if (datum === requested) return true;

  const time = datum instanceof Date ? datum.getTime() : undefined;

  if (time !== undefined) return typeof requested === 'number' && time === requested;

  const a = parseFiniteNumber(datum);
  const b = parseFiniteNumber(requested);

  if (a !== null && b !== null) return a === b;

  return typeof datum === 'string' && typeof requested === 'string' && datum.trim() === requested.trim();
}

export function matchingSceneItems(
  view: VegaViewLike,
  fields: Record<string, unknown>,
  markName?: string,
  limit = 2,
  markTypes?: ReadonlySet<string>,
): VegaSceneItem[] {
  const entries = Object.entries(fields);
  if (!entries.length) return [];
  const matches: VegaSceneItem[] = [];
  for (const item of sceneItems(view)) {
    if (
      item.bounds &&
      item.datum &&
      (!markName || item.mark?.name === markName) &&
      (!markTypes?.size || markTypes.has(item.mark?.marktype ?? '')) &&
      entries.every(([key, value]) => Object.hasOwn(item.datum!, key) && valuesMatch(item.datum![key], value))
    ) {
      matches.push(item);
      if (matches.length >= limit) break;
    }
  }
  return matches;
}

/** A mark as hovering sees it: its name and type, how many items it draws, and its datum fields. */
export type SceneMarkSummary = { name: string; type: string; items: number; fields: string[] };

/**
 * The named marks whose items carry data, for a caller whose fields matched nothing. Marks that share
 * a requested field come first, so the summary points at the mark the caller most likely meant.
 */
export function sceneMarks(view: VegaViewLike, requested: readonly string[]): SceneMarkSummary[] {
  const marks = new Map<string, SceneMarkSummary>();
  for (const item of sceneItems(view)) {
    const name = item.mark?.name;
    if (!name || !item.datum) continue;
    const mark = marks.get(name);
    if (mark) mark.items++;
    else marks.set(name, { name, type: item.mark?.marktype ?? '', items: 1, fields: Object.keys(item.datum) });
  }
  const shared = (mark: SceneMarkSummary) => requested.filter((field) => mark.fields.includes(field)).length;
  return [...marks.values()].sort((a, b) => shared(b) - shared(a));
}
