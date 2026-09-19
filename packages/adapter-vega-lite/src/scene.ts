import type { VegaViewLike } from './types.js';

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
  const graph = view.scenegraph?.() as { root?: VegaSceneItem } | undefined;
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
  const origin = view.origin?.() ?? [0, 0];
  const padding = view.padding?.();
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

function parseDateMs(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  if (value instanceof Date) {
    const t = value.getTime();

    return Number.isFinite(t) ? t : null;
  }

  if (typeof value !== 'string') return null;
  const s = value.trim();
  // Avoid Date.parse() treating numeric strings (e.g. "11.1") as dates.
  const looksLikeDate = /[a-z]/i.test(s) || s.includes('-') || s.includes('T') || s.includes(':') || s.includes('/');

  if (!looksLikeDate) return null;
  const t = Date.parse(s);

  return Number.isFinite(t) ? t : null;
}

function valuesMatch(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  const aDate = parseDateMs(a);
  const bDate = parseDateMs(b);

  if (aDate !== null && bDate !== null) return aDate === bDate;

  const aNum = parseFiniteNumber(a);
  const bNum = parseFiniteNumber(b);

  if (aNum !== null && bNum !== null) return aNum === bNum;

  if (typeof a === 'string' && typeof b === 'string') return a.trim() === b.trim();

  if (typeof a === 'string' && typeof b === 'number') return a.trim() === String(b);

  if (typeof a === 'number' && typeof b === 'string') return String(a) === b.trim();

  return false;
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
