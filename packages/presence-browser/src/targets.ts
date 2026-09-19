import type { PresenceGeometry, PresenceResolver, PresenceTarget } from '@vacp/presence-core';
import type { VacpFocus } from '@vacp/protocol';

export const browserPresenceSurface = 'viewport';

/** Browser bindings use CSS viewport pixels in the owning document. */
export function elementPresenceTarget(
  element: Element,
  precision: PresenceTarget['precision'] = 'surface',
): PresenceTarget | null {
  if (!element.isConnected || !element.getClientRects().length) return null;
  const rect = element.getBoundingClientRect();
  const view = element.ownerDocument.defaultView;
  if (
    !view ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.right <= 0 ||
    rect.bottom <= 0 ||
    rect.left >= view.innerWidth ||
    rect.top >= view.innerHeight
  )
    return null;
  const x = Math.max(0, rect.x),
    y = Math.max(0, rect.y);
  return {
    surface: browserPresenceSurface,
    precision,
    geometry: {
      kind: 'region',
      x,
      y,
      width: Math.min(view.innerWidth, rect.right) - x,
      height: Math.min(view.innerHeight, rect.bottom) - y,
    },
  };
}

/** Project SVG-local coordinates through the element's live screen transform, including facets. */
export function svgPresenceTarget(
  element: SVGGraphicsElement,
  geometry: PresenceGeometry,
  precision: PresenceTarget['precision'] = 'exact',
): PresenceTarget | null {
  if (!elementPresenceTarget(element)) return null;
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
  return { surface: browserPresenceSurface, geometry: projected, precision };
}

/** Bind application refs explicitly. No selector inference or event simulation. */
export function createElementPresenceResolver(resolve: (focus: VacpFocus) => Element | null): PresenceResolver {
  return (focus, { signal }) => {
    signal.throwIfAborted();
    const element = resolve(focus);
    return element ? elementPresenceTarget(element) : null;
  };
}

/** One shared layout subscription per surface, independent of cursor frames. */
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
  const resize = new ResizeObserver(refresh);
  resize.observe(root);
  const mutations = new MutationObserver(refresh);
  mutations.observe(root, { childList: true, subtree: true, attributes: true });
  view.addEventListener('scroll', refresh, true);
  view.addEventListener('resize', refresh);
  view.visualViewport?.addEventListener('resize', refresh);
  view.visualViewport?.addEventListener('scroll', refresh);
  return () => {
    view.cancelAnimationFrame(frame);
    resize.disconnect();
    mutations.disconnect();
    view.removeEventListener('scroll', refresh, true);
    view.removeEventListener('resize', refresh);
    view.visualViewport?.removeEventListener('resize', refresh);
    view.visualViewport?.removeEventListener('scroll', refresh);
  };
}
