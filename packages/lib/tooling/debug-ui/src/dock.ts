type DockPos = { left: number };

const DOCK_MARGIN = 14;
const DRAG_THRESHOLD = 6;

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function readPos(storageKey: string): DockPos | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { left?: unknown };
    if (typeof parsed.left !== 'number' || !Number.isFinite(parsed.left)) return null;
    return { left: parsed.left };
  } catch {
    return null;
  }
}

function savePos(storageKey: string, pos: DockPos): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(pos));
  } catch {
    // ignore
  }
}

function dockTop(root: HTMLElement): number {
  return window.innerHeight - root.getBoundingClientRect().height - DOCK_MARGIN;
}

function dockLeftBounds(root: HTMLElement): { min: number; max: number } {
  const width = root.getBoundingClientRect().width;
  return { min: DOCK_MARGIN, max: Math.max(DOCK_MARGIN, window.innerWidth - width - DOCK_MARGIN) };
}

function applyDockLeft(root: HTMLElement, left: number): DockPos {
  const bounds = dockLeftBounds(root);
  const next = { left: clamp(left, bounds.min, bounds.max) };
  root.style.left = `${next.left}px`;
  root.style.top = `${dockTop(root)}px`;
  root.style.right = 'auto';
  root.style.bottom = 'auto';
  return next;
}

/**
 * Bottom-rail dock for the debug overlay.
 *
 * Dragging a dock handle moves the shared anchor. The panel derives its
 * position from this anchor instead of storing an independent coordinate.
 */
export function createVacpDebugDock(args: {
  root: HTMLElement;
  handles: HTMLElement[];
  storageKey: string;
  onMove?: () => void;
  onDrop?: () => void;
}) {
  const { root, handles, storageKey, onMove, onDrop } = args;

  const applyInitialPos = () => {
    const saved = readPos(storageKey);
    const bounds = dockLeftBounds(root);
    const initial = saved ?? { left: bounds.max };
    const next = applyDockLeft(root, initial.left);
    savePos(storageKey, next);
    onMove?.();
  };

  const moveTo = (left: number) => {
    const next = applyDockLeft(root, left);
    onMove?.();
    return next;
  };

  const commitPosition = () => {
    const rect = root.getBoundingClientRect();
    const next = moveTo(rect.left);
    savePos(storageKey, next);
    onDrop?.();
  };

  const installDrag = (handle: HTMLElement) => {
    let dragging = false;
    let suppressClick = false;
    let startX = 0;
    let startLeft = 0;
    let raf = 0;
    let pendingX: number | null = null;

    const beginDrag = () => {
      if (dragging) return;
      dragging = true;
      root.classList.add('vacp-debug-ui-dragging');
    };

    const move = (x: number) => {
      const dx = x - startX;
      if (!dragging && Math.abs(dx) < DRAG_THRESHOLD) return;
      beginDrag();
      moveTo(startLeft + dx);
    };

    const scheduleMove = (x: number) => {
      pendingX = x;
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        if (pendingX === null) return;
        const next = pendingX;
        pendingX = null;
        move(next);
      });
    };

    const cleanupWindowListeners = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
      pendingX = null;
    };

    const onPointerMove = (ev: PointerEvent) => {
      scheduleMove(ev.clientX);
    };

    const onPointerUp = (ev: PointerEvent) => {
      const finalX = pendingX ?? ev.clientX;
      cleanupWindowListeners();
      if (!dragging) return;
      move(finalX);
      dragging = false;
      suppressClick = true;
      root.classList.remove('vacp-debug-ui-dragging');
      commitPosition();
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
      const target = ev.target as Element | null;
      const interactive = target?.closest('button, a, input, textarea, select, option, [role="button"]');
      if (interactive && interactive !== handle) return;
      const rect = root.getBoundingClientRect();
      dragging = false;
      suppressClick = false;
      startX = ev.clientX;
      startLeft = rect.left;
      handle.setPointerCapture?.(ev.pointerId);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    });
  };

  const attach = () => {
    handles.forEach((handle) => installDrag(handle));
    queueMicrotask(() => applyInitialPos());
    window.addEventListener('resize', () => {
      const rect = root.getBoundingClientRect();
      const next = applyDockLeft(root, rect.left);
      savePos(storageKey, next);
      onMove?.();
    });
  };

  return { attach };
}
