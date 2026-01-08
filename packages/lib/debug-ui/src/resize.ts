type Size = { width: number; height: number };

/**
 * Panel resizing (pure UI plumbing).
 *
 * The debug overlay is meant to be usable while developing:
 * - you often want it bigger on large screens
 * - you often want it smaller on cramped pages
 * - sizes should persist per-browser profile
 */
export function installVacpDebugResizer(args: { panel: HTMLElement; storageKey: string; onResizeEnd?: () => void }) {
  const { panel, storageKey, onResizeEnd } = args;

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

  const handleBR = document.createElement('div');
  handleBR.className = 'vacp-debug-ui-resizer';
  handleBR.title = 'Resize overlay panel';

  const handleBL = document.createElement('div');
  handleBL.className = 'vacp-debug-ui-resizer vacp-debug-ui-resizer-left';
  handleBL.title = 'Resize overlay panel';

  panel.append(handleBR, handleBL);

  let resizing = false;
  let mode: 'br' | 'bl' = 'br';
  let startX = 0;
  let startY = 0;
  let startW = 0;
  let startH = 0;
  let startLeft = 0;

  const onMove = (ev: PointerEvent) => {
    if (!resizing) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (mode === 'br') {
      apply({ width: startW + dx, height: startH + dy });
      return;
    }
    // Bottom-left: keep the right edge anchored, adjust `left` with width.
    const margin = 10;
    const maxW = Math.max(360, window.innerWidth - 28);
    const maxH = Math.max(260, window.innerHeight - 92);
    const w = clamp(startW - dx, 360, maxW);
    const h = clamp(startH + dy, 260, maxH);
    const rightEdge = startLeft + startW;
    let left = rightEdge - w;
    left = clamp(left, margin, Math.max(margin, window.innerWidth - w - margin));
    panel.style.left = `${left}px`;
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
    onResizeEnd?.();
  };

  const begin = (ev: PointerEvent, nextMode: 'br' | 'bl') => {
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
    (nextMode === 'br' ? handleBR : handleBL).setPointerCapture?.(ev.pointerId);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  handleBR.addEventListener('pointerdown', (ev) => begin(ev, 'br'));
  handleBL.addEventListener('pointerdown', (ev) => begin(ev, 'bl'));
}
