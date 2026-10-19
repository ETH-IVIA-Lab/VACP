import type { PresenceGeometry, PresencePoint } from '@ethivia/vacp-presence-core';
import { placeBubble, targetBounds, type BubblePlacement } from './bubble-layout';

type Viewport = { width: number; height: number };
type Layout = { point: PresencePoint; viewport: Viewport; beside: PresenceGeometry | undefined; reduced: boolean };
export type BubblePart = 'root' | 'surface' | 'content';

const timing = { duration: 220, easing: 'cubic-bezier(.23,1,.32,1)' };

/**
 * Where the label settles and how it gets there. The root carries the position, the surface paints the
 * background, and the content holds the words; the surface shares the root's box. A settled label
 * moves continuously from wherever it is painted, and a label that changes height reaches its final
 * layout once while a FLIP eases the paint.
 */
export function createBubbleMotion(width: number) {
  const parts: Partial<Record<BubblePart, HTMLElement>> = {};
  let observer: ResizeObserver | undefined;
  let placement: BubblePlacement | undefined;
  /** Painted frame by frame under a travelling cursor, away from the last settled placement. */
  let riding = false;
  let movement: Animation | undefined;
  let resizing: Animation[] = [];
  let height = 0;
  let measuredWidth = 0;
  let dirty = true;
  let last: Layout | undefined;
  let planned: { key: string; placement: BubblePlacement } | undefined;
  const measure = (viewport: Viewport) => {
    const w = Math.min(width, Math.max(0, viewport.width - 24));
    if (parts.root && (dirty || measuredWidth !== w)) {
      height = parts.root.offsetHeight;
      measuredWidth = w;
      dirty = false;
    }
    return w;
  };
  const stop = () => {
    movement?.cancel();
    movement = undefined;
    for (const motion of resizing) motion.cancel();
    resizing = [];
  };
  const binders: Partial<Record<BubblePart, (element: HTMLElement | null) => () => void>> = {};
  const api = {
    /** A stable ref callback for one part of the label. */
    bind(part: BubblePart) {
      return (binders[part] ??= (element: HTMLElement | null) => {
        if (element) parts[part] = element;
        if (part === 'root' && element) {
          dirty = true;
          observer = new (element.ownerDocument.defaultView ?? globalThis).ResizeObserver(([entry]) => {
            // The observed border box is the committed height; reading it again would force layout.
            const size = entry?.borderBoxSize[0]?.blockSize;
            if (size === undefined) dirty = true;
            else if (Math.round(size) === height) return;
            else height = Math.round(size);
            if (last) api.place(last.point, last.viewport, last.beside, last.reduced);
          });
          observer.observe(element);
        }
        return () => {
          if (!element || parts[part] !== element) return;
          delete parts[part];
          if (part !== 'root') return;
          observer?.disconnect();
          observer = undefined;
          stop();
        };
      });
    },
    /** A label waiting for its target's next layout is hidden, keeping its place. */
    show(visible: boolean) {
      if (parts.root) parts.root.style.visibility = visible ? 'visible' : 'hidden';
    },
    /** The words changed; the next placement measures the label again. */
    invalidate() {
      dirty = true;
    },
    /** Where the label settles beside `beside`, or beside the cursor point when there is no geometry. */
    plan(point: PresencePoint, viewport: Viewport, beside: PresenceGeometry | undefined) {
      const w = measure(viewport);
      const target = beside ? targetBounds(beside) : { x: point.x - 12, y: point.y - 12, width: 24, height: 24 };
      // A flight asks every frame with the same inputs; the answer changes only when they do.
      const key = [
        point.x,
        point.y,
        target.x,
        target.y,
        target.width,
        target.height,
        w,
        height,
        viewport.width,
        viewport.height,
        placement?.side,
      ].join();
      if (planned?.key !== key)
        planned = { key, placement: placeBubble(target, point, { width: w, height }, viewport, placement) };
      return planned.placement;
    },
    /** The painted surface, including any running movement or resize. */
    painted(): PresencePoint & { height: number } {
      if (!parts.surface) return { x: placement?.x ?? 0, y: placement?.y ?? 0, height };
      const { x, y, height: painted } = parts.surface.getBoundingClientRect();
      return { x, y, height: painted };
    },
    /** Settle the label, moving it continuously from wherever it is painted now. */
    place(point: PresencePoint, viewport: Viewport, beside: PresenceGeometry | undefined, reduced: boolean) {
      const { root, surface, content } = parts;
      if (!root || !surface || !content) return;
      last = { point, viewport, beside, reduced };
      const next = api.plan(point, viewport, beside);
      const moving =
        riding || movement?.playState === 'running' || resizing.some((motion) => motion.playState === 'running');
      // A followed, moving, or resizing label starts from where it is painted; otherwise the last placement is exact.
      const from = moving ? api.painted() : placement;
      const sizeChanged = !!from && Math.abs(from.height - height) > 0.5;
      const moved = !from || Math.abs(from.x - next.x) > 0.5 || Math.abs(from.y - next.y) > 0.5;
      riding = false;
      placement = next;
      if (!moved && !sizeChanged) return;
      stop();
      root.style.transform = `translate(${next.x}px,${next.y}px)`;
      if (!from || reduced) return;
      if (sizeChanged) {
        // The layout reaches its final size once; the surface and words ease from where they were painted.
        const shift = `translate(${from.x - next.x}px,${from.y - next.y}px)`;
        resizing = [
          surface.animate([{ transform: `${shift} scaleY(${from.height / height})` }, { transform: 'none' }], timing),
          content.animate([{ transform: shift }, { transform: 'none' }], timing),
        ];
      } else
        movement = root.animate(
          [{ transform: `translate(${from.x}px,${from.y}px)` }, { transform: `translate(${next.x}px,${next.y}px)` }],
          timing,
        );
    },
    /** Paint the label at a point chosen frame by frame, while its cursor travels. */
    follow(x: number, y: number) {
      if (!parts.root) return;
      if (!riding) {
        // Height changes mid-flight only reposition once the cursor settles.
        last = undefined;
        stop();
        riding = true;
      }
      parts.root.style.transform = `translate(${x}px,${y}px)`;
    },
    root: () => parts.root,
    stop,
  };
  return api;
}

export type BubbleMotion = ReturnType<typeof createBubbleMotion>;
