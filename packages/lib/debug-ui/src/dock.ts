type DockPos = { left: number; top: number };

/**
 * Floating overlay docking + snapping.
 *
 * This is UI plumbing, not VACP logic:
 * - remembers position in localStorage
 * - snaps to a small set of stable anchors
 * - keeps the panel opening direction sensible
 */
export function createVacpDebugDock(args: {
  root: HTMLElement;
  panel: HTMLElement;
  button: HTMLElement;
  titleEl: HTMLElement;
  storageKey: string;
}) {
  const { root, panel, button, titleEl, storageKey } = args;

  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
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

  const positionPanel = () => {
    const rect = root.getBoundingClientRect();
    const openDown = rect.top < window.innerHeight / 2;
    const openRight = rect.left < window.innerWidth / 2;
    const gap = 10;
    const btnRect = button.getBoundingClientRect();
    const btnH = btnRect.height || 40;

    panel.style.top = openDown ? `${btnH + gap}px` : 'auto';
    panel.style.bottom = openDown ? 'auto' : `${btnH + gap}px`;
    panel.style.left = openRight ? '0px' : 'auto';
    panel.style.right = openRight ? 'auto' : '0px';
  };

  const snapToNearest = (opts?: { animate?: boolean }) => {
    const rect = root.getBoundingClientRect();
    const target = nearestSnapPos({ left: rect.left, top: rect.top });
    const animate = !!opts?.animate && !prefersReducedMotion;
    if (animate) root.classList.add('vacp-debug-ui-snap');
    applyPos(target);
    positionPanel();
    const nextRect = root.getBoundingClientRect();
    savePos({ left: nextRect.left, top: nextRect.top });
    if (!animate) return;
    const cleanup = () => root.classList.remove('vacp-debug-ui-snap');
    root.addEventListener('transitionend', cleanup, { once: true });
    window.setTimeout(cleanup, 260);
  };

  const applyInitialPos = () => {
    const saved = readPos();
    if (saved) {
      applyPos(saved);
    } else {
      const b = button.getBoundingClientRect();
      applyPos({ left: window.innerWidth - b.width - 14, top: window.innerHeight - b.height - 14 });
    }
    snapToNearest({ animate: false });
  };

  const installDrag = (handle: HTMLElement) => {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const onMove = (ev: PointerEvent) => {
      if (!dragging) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      applyPos({ left: startLeft + dx, top: startTop + dy });
      positionPanel();
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      root.classList.remove('vacp-debug-ui-dragging');
      snapToNearest({ animate: true });
    };

    handle.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      dragging = true;
      root.classList.remove('vacp-debug-ui-snap');
      root.classList.add('vacp-debug-ui-dragging');
      const rect = root.getBoundingClientRect();
      startX = ev.clientX;
      startY = ev.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      handle.setPointerCapture?.(ev.pointerId);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  };

  const attach = () => {
    installDrag(button);
    installDrag(titleEl);
    queueMicrotask(() => applyInitialPos());
    window.addEventListener('resize', () => snapToNearest({ animate: false }));
  };

  return { attach, positionPanel, snapToNearest, installDrag };
}
