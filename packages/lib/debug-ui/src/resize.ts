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

  const handle = document.createElement('div');
  handle.className = 'vacp-debug-ui-resizer';
  handle.title = 'Resize overlay panel';
  panel.append(handle);

  let resizing = false;
  let startX = 0;
  let startY = 0;
  let startW = 0;
  let startH = 0;

  const onMove = (ev: PointerEvent) => {
    if (!resizing) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    apply({ width: startW + dx, height: startH + dy });
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

  handle.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    resizing = true;
    panel.classList.add('vacp-debug-ui-resizing');
    const rect = panel.getBoundingClientRect();
    startX = ev.clientX;
    startY = ev.clientY;
    startW = rect.width;
    startH = rect.height;
    handle.setPointerCapture?.(ev.pointerId);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}
