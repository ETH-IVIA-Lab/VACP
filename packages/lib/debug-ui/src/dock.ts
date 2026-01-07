type DockPos = { left: number; top: number };

/**
 * Floating button docking + snapping.
 *
 * The "bar" should feel like devtools overlays:
 * - draggable but not fiddly
 * - snaps to stable anchors
 * - persists position
 */
export function createVacpDebugDock(args: {
  root: HTMLElement;
  handles: HTMLElement[];
  storageKey: string;
  onMove?: () => void;
  onDrop?: () => void;
}) {
  const { root, handles, storageKey, onMove: onDockMove, onDrop } = args;

  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
  const DRAG_THRESHOLD = 6;
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const readPos = (): DockPos | null => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { left?: unknown; top?: unknown };
      if (typeof parsed.left !== 'number' || typeof parsed.top !== 'number') return null;
      return { left: parsed.left, top: parsed.top };
    } catch {
      return null;
    }
  };

  const savePos = (pos: DockPos) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(pos));
    } catch {
      // ignore
    }
  };

  const applyPos = (pos: DockPos) => {
    const margin = 10;
    const rect = root.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - margin;
    const maxTop = window.innerHeight - rect.height - margin;
    root.style.left = `${clamp(pos.left, margin, maxLeft)}px`;
    root.style.top = `${clamp(pos.top, margin, maxTop)}px`;
    root.style.right = 'auto';
    root.style.bottom = 'auto';
  };

  const snapTargets = (rect: DOMRect): DockPos[] => {
    const margin = 10;
    const left = margin;
    const right = Math.max(margin, window.innerWidth - rect.width - margin);
    const top = margin;
    const bottom = Math.max(margin, window.innerHeight - rect.height - margin);
    const centerX = clamp((window.innerWidth - rect.width) / 2, margin, right);
    const centerY = clamp((window.innerHeight - rect.height) / 2, margin, bottom);
    const xs = [left, centerX, right];
    const ys = [top, centerY, bottom];
    const out: DockPos[] = [];
    ys.forEach((y) => xs.forEach((x) => out.push({ left: x, top: y })));
    return out;
  };

  const nearestSnapPos = (pos: DockPos): DockPos => {
    const rect = root.getBoundingClientRect();
    const targets = snapTargets(rect);
    let best = targets[0]!;
    let bestD = Number.POSITIVE_INFINITY;
    for (const t of targets) {
      const dx = t.left - pos.left;
      const dy = t.top - pos.top;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  };

  const snapToNearest = (opts?: { animate?: boolean }) => {
    const rect = root.getBoundingClientRect();
    const target = nearestSnapPos({ left: rect.left, top: rect.top });
    const animate = !!opts?.animate && !prefersReducedMotion;
    if (animate) root.classList.add('vacp-debug-ui-snap');
    applyPos(target);
    const nextRect = root.getBoundingClientRect();
    savePos({ left: nextRect.left, top: nextRect.top });
    onDockMove?.();
    if (!animate) return;
    const cleanup = () => root.classList.remove('vacp-debug-ui-snap');
    root.addEventListener('transitionend', cleanup, { once: true });
    window.setTimeout(cleanup, 220);
  };

  const applyInitialPos = () => {
    const saved = readPos();
    if (saved) {
      applyPos(saved);
    } else {
      const margin = 14;
      const rect = root.getBoundingClientRect();
      applyPos({ left: window.innerWidth - rect.width - margin, top: window.innerHeight - rect.height - margin });
    }
    snapToNearest({ animate: false });
  };

  const installDrag = (handle: HTMLElement) => {
    let dragging = false;
    let suppressClick = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let lastPointerDownAt = 0;

    const beginDrag = () => {
      if (dragging) return;
      dragging = true;
      root.classList.remove('vacp-debug-ui-snap');
      root.classList.add('vacp-debug-ui-dragging');
    };

    const maybeMove = (x: number, y: number) => {
      const dx = x - startX;
      const dy = y - startY;
      const dist = Math.abs(dx) + Math.abs(dy);

      // Treat small movements as a click, not a drag, so the button remains usable.
      if (!dragging && dist < DRAG_THRESHOLD) return;
      beginDrag();
      applyPos({ left: startLeft + dx, top: startTop + dy });
      onDockMove?.();
    };

    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      suppressClick = true;
      root.classList.remove('vacp-debug-ui-dragging');
      snapToNearest({ animate: true });
      onDrop?.();
    };

    const onPointerMove = (ev: PointerEvent) => maybeMove(ev.clientX, ev.clientY);
    const onMouseMove = (ev: MouseEvent) => maybeMove(ev.clientX, ev.clientY);

    const cleanupWindowListeners = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    const onPointerUp = () => {
      cleanupWindowListeners();
      endDrag();
    };

    const onMouseUp = () => {
      cleanupWindowListeners();
      endDrag();
    };

    const start = (x: number, y: number) => {
      suppressClick = false;
      dragging = false;
      const rect = root.getBoundingClientRect();
      startX = x;
      startY = y;
      startLeft = rect.left;
      startTop = rect.top;
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    };

    handle.addEventListener(
      'click',
      (ev) => {
        if (!suppressClick) return;
        suppressClick = false;
        ev.preventDefault();
        ev.stopPropagation();
      },
      { capture: true },
    );

    handle.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      lastPointerDownAt = performance.now();
      start(ev.clientX, ev.clientY);
    });

    // Fallback for environments that do not emit PointerEvents for mouse input.
    handle.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      if (performance.now() - lastPointerDownAt < 40) return;
      start(ev.clientX, ev.clientY);
    });
  };

  const attach = () => {
    handles.forEach((h) => installDrag(h));
    queueMicrotask(() => applyInitialPos());
    window.addEventListener('resize', () => snapToNearest({ animate: false }));
  };

  return { attach, snapToNearest };
}
