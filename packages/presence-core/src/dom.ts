import type { PresenceGeometry, PresenceResolver, PresenceTarget } from './types';
import type { VacpFocus } from '@vacp/protocol';

const browserPresenceSurface = 'viewport';

type Edges = { left: number; top: number; right: number; bottom: number };

/**
 * Clip viewport geometry to the surface's composed ancestry, including shadow hosts. The document's own
 * scrolling box is the viewport, which callers apply separately so off-screen targets stay distinguishable.
 */
function clipPresenceRect(element: Element, rect: Edges): Edges | null {
  const doc = element.ownerDocument;
  const view = doc.defaultView!;
  let { left, top, right, bottom } = rect;
  const parentOf = (child: Element): Element | null => {
    const root = child.getRootNode();
    return child.assignedSlot ?? child.parentElement ?? (root instanceof view.ShadowRoot ? root.host : null);
  };
  for (let parent = parentOf(element); parent; parent = parentOf(parent)) {
    if (parent === doc.documentElement || parent === doc.body) continue;
    const style = view.getComputedStyle(parent);
    const bounds = parent.getBoundingClientRect();
    // client metrics are layout pixels. The clipping rectangle lives in viewport pixels.
    const scaleX = parent instanceof view.HTMLElement && parent.offsetWidth ? bounds.width / parent.offsetWidth : 1;
    const scaleY = parent instanceof view.HTMLElement && parent.offsetHeight ? bounds.height / parent.offsetHeight : 1;
    if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
      left = Math.max(left, bounds.left + parent.clientLeft * scaleX);
      right = Math.min(right, bounds.left + (parent.clientLeft + parent.clientWidth) * scaleX);
    }
    if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
      top = Math.max(top, bounds.top + parent.clientTop * scaleY);
      bottom = Math.min(bottom, bounds.top + (parent.clientTop + parent.clientHeight) * scaleY);
    }
  }
  return right >= left && bottom >= top ? { left, top, right, bottom } : null;
}

/** One viewport clipping policy for DOM, SVG and canvas-backed semantic targets. */
export function viewportPresenceTarget(
  element: Element,
  geometry: PresenceGeometry,
  precision: PresenceTarget['precision'] = 'exact',
): PresenceTarget | null {
  const view = element.ownerDocument.defaultView;
  if (
    !view ||
    !element.isConnected ||
    !element.getClientRects().length ||
    view.getComputedStyle(element).visibility !== 'visible'
  )
    return null;
  const points =
    geometry.kind === 'point'
      ? [geometry.point]
      : geometry.kind === 'path'
        ? geometry.points
        : [
            { x: geometry.x, y: geometry.y },
            { x: geometry.x + geometry.width, y: geometry.y + geometry.height },
          ];
  if (!points.length || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  const xs = points.map((point) => point.x),
    ys = points.map((point) => point.y);
  const original = { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
  const collapsed = (edges: Edges) =>
    (original.right > original.left && edges.right === edges.left) ||
    (original.bottom > original.top && edges.bottom === edges.top);
  const region = (edges: Edges): PresenceTarget => ({
    surface: browserPresenceSurface,
    geometry: {
      kind: 'region',
      x: edges.left,
      y: edges.top,
      width: edges.right - edges.left,
      height: edges.bottom - edges.top,
    },
    precision: 'region',
  });
  const same = (a: Edges, b: Edges) =>
    a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;
  // Hidden by a scroll container or clip: there is no place to point at.
  const within = clipPresenceRect(element, original);
  if (!within || collapsed(within)) return null;
  const visible = {
    left: Math.max(0, within.left),
    top: Math.max(0, within.top),
    right: Math.min(view.innerWidth, within.right),
    bottom: Math.min(view.innerHeight, within.bottom),
  };
  // Outside the viewport only: report where it is, so presentation can hide the cursor and point that way.
  if (visible.right < visible.left || visible.bottom < visible.top || collapsed(visible))
    return same(within, original) ? { surface: browserPresenceSurface, geometry, precision } : region(within);
  // Partial visibility witnesses a region, never a hidden path or an exact native target.
  return same(visible, original) ? { surface: browserPresenceSurface, geometry, precision } : region(visible);
}

/** Browser bindings use CSS viewport pixels in the owning document. */
export function elementPresenceTarget(
  element: Element,
  precision: PresenceTarget['precision'] = 'surface',
): PresenceTarget | null {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return viewportPresenceTarget(
    element,
    { kind: 'region', x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    precision,
  );
}

/** Project SVG-local coordinates through the element's live screen transform, including facets. */
export function svgPresenceTarget(
  element: SVGGraphicsElement,
  geometry: PresenceGeometry,
  precision: PresenceTarget['precision'] = 'exact',
): PresenceTarget | null {
  // The projected geometry is clipped once below. This only rejects an unrendered element.
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const matrix = element.getScreenCTM();
  if (!matrix) return null;
  const point = (p: { x: number; y: number }) => ({
    x: matrix.a * p.x + matrix.c * p.y + matrix.e,
    y: matrix.b * p.x + matrix.d * p.y + matrix.f,
  });
  const projected: PresenceGeometry =
    geometry.kind === 'point'
      ? { kind: 'point', point: point(geometry.point) }
      : geometry.kind === 'path'
        ? { kind: 'path', points: geometry.points.map(point) }
        : {
            kind: 'path',
            points: [
              point({ x: geometry.x, y: geometry.y }),
              point({ x: geometry.x + geometry.width, y: geometry.y }),
              point({ x: geometry.x + geometry.width, y: geometry.y + geometry.height }),
              point({ x: geometry.x, y: geometry.y + geometry.height }),
              point({ x: geometry.x, y: geometry.y }),
            ],
          };
  return viewportPresenceTarget(element, projected, precision);
}

/** Bind application refs explicitly. No selector inference or event simulation. */
export function createElementPresenceResolver(resolve: (focus: VacpFocus) => Element | null): PresenceResolver {
  return (focus, { signal }) => {
    signal.throwIfAborted();
    const element = resolve(focus);
    return element ? elementPresenceTarget(element) : null;
  };
}

/** Paint-only attributes, such as a hover highlight's fill or opacity, leave every target in place. */
const paintAttributes = new Set([
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-opacity',
  'opacity',
  'color',
  'stop-color',
  'stop-opacity',
]);

/**
 * A layout witness for a surface: size changes of `root`, and structure, text, or attributes other than
 * paint changing inside it, at most once per animation frame. Browser presence owns viewport scroll and
 * resize, and runs a witness only while a pointer rests on its surface.
 */
export function observePresenceLayout(root: Element, invalidate: () => void): () => void {
  const view = root.ownerDocument.defaultView;
  if (!view) return () => {};
  let frame = 0;
  const refresh = () => {
    if (!frame)
      frame = view.requestAnimationFrame(() => {
        frame = 0;
        invalidate();
      });
  };
  // Observing reports the current size once. The lookup that started this witness already measured it.
  let sized = false;
  const resize = new view.ResizeObserver(() => {
    if (sized) refresh();
    sized = true;
  });
  resize.observe(root);
  const mutations = new view.MutationObserver((records) => {
    if (records.some((record) => record.type !== 'attributes' || !paintAttributes.has(record.attributeName!)))
      refresh();
  });
  mutations.observe(root, { childList: true, characterData: true, subtree: true, attributes: true });
  return () => {
    view.cancelAnimationFrame(frame);
    resize.disconnect();
    mutations.disconnect();
  };
}
