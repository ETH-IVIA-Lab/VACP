type Size = { width: number; height: number };
type Pos = { left: number; top: number };

/**
 * Panel resizing (pure UI plumbing).
 *
 * The debug overlay is meant to be usable while developing:
 * - you often want it bigger on large screens
 * - you often want it smaller on cramped pages
 * - sizes should persist per-browser profile
 */
export function installVacpDebugResizer(args: {
  panel: HTMLElement;
  storageKey: string;
  positionStorageKey?: string;
  onResizeEnd?: () => void;
}) {
  const { panel, storageKey, positionStorageKey, onResizeEnd } = args;

  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
  const read = (): Size | null => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { width?: unknown; height?: unknown };
      if (typeof parsed.width !== 'number' || typeof parsed.height !== 'number') return null;
      return { width: parsed.width, height: parsed.height };
    } catch {
      return null;
    }
  };
  const save = (size: Size) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(size));
    } catch {
      // ignore
    }
  };
  const savePos = (pos: Pos) => {
    if (!positionStorageKey) return;
    try {
      localStorage.setItem(positionStorageKey, JSON.stringify(pos));
    } catch {
      // ignore
    }
  };

  const apply = (size: Size) => {
    const margin = 28;
    const maxW = Math.max(360, window.innerWidth - margin);
    const maxH = Math.max(260, window.innerHeight - 92);
    const w = clamp(size.width, 360, maxW);
    const h = clamp(size.height, 260, maxH);
    panel.style.width = `${w}px`;
    panel.style.height = `${h}px`;
  };

  const initial = read();
  if (initial) queueMicrotask(() => apply(initial));

  const createHandle = (dir: string, cursor: string) => {
    const el = document.createElement('div');
    el.className = `vacp-debug-ui-resize-handle vacp-debug-ui-resize-${dir}`;
    el.title = 'Resize overlay panel';
    el.style.cursor = cursor;
    return el;
  };

  const handles = [
    createHandle('n', 'ns-resize'),
    createHandle('s', 'ns-resize'),
    createHandle('e', 'ew-resize'),
    createHandle('w', 'ew-resize'),
    createHandle('ne', 'nesw-resize'),
    createHandle('nw', 'nwse-resize'),
    createHandle('se', 'nwse-resize'),
    createHandle('sw', 'nesw-resize'),
  ];

  for (const h of handles) panel.append(h);

  let resizing = false;
  let mode: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' = 'se';
  let startX = 0;
  let startY = 0;
  let startW = 0;
  let startH = 0;
  let startLeft = 0;
  let startTop = 0;

  const onMove = (ev: PointerEvent) => {
    if (!resizing) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;

    const margin = 10;
    const maxW = Math.max(360, window.innerWidth - 28);
    const maxH = Math.max(260, window.innerHeight - 92);

    const rightEdge = startLeft + startW;
    const bottomEdge = startTop + startH;

    const wantsW = mode.includes('w');
    const wantsE = mode.includes('e');
    const wantsN = mode.includes('n');
    const wantsS = mode.includes('s');

    let w = startW;
    let h = startH;
    let left = startLeft;
    let top = startTop;

    if (wantsE) w = clamp(startW + dx, 360, maxW);
    if (wantsS) h = clamp(startH + dy, 260, maxH);

    if (wantsW) {
      w = clamp(startW - dx, 360, maxW);
      left = rightEdge - w;
    }
    if (wantsN) {
      h = clamp(startH - dy, 260, maxH);
      top = bottomEdge - h;
    }

    left = clamp(left, margin, Math.max(margin, window.innerWidth - w - margin));
    top = clamp(top, margin, Math.max(margin, window.innerHeight - h - margin));

    // If we clamped position while resizing from the anchored side, adjust
    // dimensions to keep the opposite edge within the viewport.
    if (wantsW) w = clamp(rightEdge - left, 360, maxW);
    if (wantsN) h = clamp(bottomEdge - top, 260, maxH);

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.width = `${w}px`;
    panel.style.height = `${h}px`;
  };

  const onUp = () => {
    if (!resizing) return;
    resizing = false;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    panel.classList.remove('vacp-debug-ui-resizing');
    const rect = panel.getBoundingClientRect();
    save({ width: rect.width, height: rect.height });
    savePos({ left: rect.left, top: rect.top });
    onResizeEnd?.();
  };

  const begin = (ev: PointerEvent, nextMode: typeof mode) => {
    if (ev.button !== 0) return;
    resizing = true;
    mode = nextMode;
    panel.classList.add('vacp-debug-ui-resizing');
    const rect = panel.getBoundingClientRect();
    startX = ev.clientX;
    startY = ev.clientY;
    startW = rect.width;
    startH = rect.height;
    startLeft = rect.left;
    startTop = rect.top;
    panel.setPointerCapture?.(ev.pointerId);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  for (const h of handles) {
    const cls = Array.from(h.classList).find(
      (c) => c.startsWith('vacp-debug-ui-resize-') && c !== 'vacp-debug-ui-resize-handle',
    );
    const dir = cls ? cls.replace('vacp-debug-ui-resize-', '') : null;
    if (!dir) continue;
    h.addEventListener('pointerdown', (ev) => begin(ev, dir as any));
  }
}
