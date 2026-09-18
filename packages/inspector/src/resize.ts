type Size = { width: number; height: number };

type ResizeMode = 'n' | 'e' | 'w' | 'ne' | 'nw';

type ResizeBounds = Partial<{
  maxWidth: number;
  maxHeight: number;
}>;

const PANEL_MARGIN = 14;

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function readSize(storageKey: string): Size | null {
  try {
    const raw = localStorage.getItem(storageKey);

    if (!raw) return null;
    const parsed = JSON.parse(raw) as { width?: unknown; height?: unknown };

    if (typeof parsed.width !== 'number' || typeof parsed.height !== 'number') return null;

    if (!Number.isFinite(parsed.width) || !Number.isFinite(parsed.height)) return null;

    return { width: parsed.width, height: parsed.height };
  } catch {
    return null;
  }
}

function saveSize(storageKey: string, size: Size): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(size));
  } catch {
    // ignore
  }
}

function applySize(panel: HTMLElement, size: Size, bounds: ResizeBounds = {}): Size {
  const availableW = Math.max(1, bounds.maxWidth ?? window.innerWidth - PANEL_MARGIN * 2);
  const minW = Math.min(360, availableW);
  const maxW = Math.max(minW, availableW);
  const maxH = Math.max(260, bounds.maxHeight ?? window.innerHeight - 92);

  const next = {
    width: clamp(size.width, minW, maxW),
    height: clamp(size.height, 260, maxH),
  };

  panel.style.width = `${next.width}px`;
  panel.style.height = `${next.height}px`;

  return next;
}

/**
 * Attached panel resizing.
 *
 * The panel has no independent position. Resize changes dimensions only, then
 * asks the layout owner to reattach the panel above the dock.
 */
export function installVacpInspectorResizer(args: {
  panel: HTMLElement;
  storageKey: string;
  onResize?: () => void;
  onResizeEnd?: () => void;
}) {
  const { panel, storageKey, onResize, onResizeEnd } = args;

  const lifetime = new AbortController();

  const initial = readSize(storageKey);

  if (initial) {
    queueMicrotask(() => {
      if (lifetime.signal.aborted) return;
      applySize(panel, initial);
      onResize?.();
    });
  }

  const createHandle = (dir: ResizeMode, cursor: string) => {
    const el = document.createElement('div');
    el.className = `vacp-inspector-resize-handle vacp-inspector-resize-${dir}`;
    el.dataset.vacpInspectorResizeHandle = dir;
    el.title = 'Resize overlay panel';
    el.style.cursor = cursor;

    return el;
  };

  const handles: Array<{ mode: ResizeMode; element: HTMLDivElement }> = [
    { mode: 'n', element: createHandle('n', 'ns-resize') },
    { mode: 'e', element: createHandle('e', 'ew-resize') },
    { mode: 'w', element: createHandle('w', 'ew-resize') },
    { mode: 'ne', element: createHandle('ne', 'nesw-resize') },
    { mode: 'nw', element: createHandle('nw', 'nwse-resize') },
  ];

  for (const { element } of handles) panel.append(element);

  let resizing = false;
  let mode: ResizeMode = 'n';
  let startX = 0;
  let startY = 0;
  let startW = 0;
  let startH = 0;
  let startMaxH = 260;

  const onMove = (ev: PointerEvent) => {
    if (!resizing) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    const wantsW = mode.includes('w');
    const wantsE = mode.includes('e');
    const wantsN = mode.includes('n');
    const width = wantsE ? startW + dx : wantsW ? startW - dx : startW;
    const height = wantsN ? startH - dy : startH;
    applySize(panel, { width, height }, { maxHeight: startMaxH });
    onResize?.();
  };

  const onUp = () => {
    if (!resizing) return;
    resizing = false;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    panel.classList.remove('vacp-inspector-resizing');
    const rect = panel.getBoundingClientRect();
    saveSize(storageKey, { width: rect.width, height: rect.height });
    onResizeEnd?.();
  };

  const begin = (ev: PointerEvent, target: HTMLElement, nextMode: ResizeMode) => {
    if (ev.button !== 0) return;
    resizing = true;
    mode = nextMode;
    panel.classList.add('vacp-inspector-resizing');
    const rect = panel.getBoundingClientRect();
    startX = ev.clientX;
    startY = ev.clientY;
    startW = rect.width;
    startH = rect.height;
    startMaxH = Math.max(260, rect.bottom - PANEL_MARGIN);
    target.setPointerCapture?.(ev.pointerId);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    ev.preventDefault();
  };

  for (const { mode: handleMode, element } of handles) {
    element.addEventListener('pointerdown', (ev) => begin(ev, element, handleMode), { signal: lifetime.signal });
  }
  return () => {
    lifetime.abort();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    for (const { element } of handles) element.remove();
    panel.classList.remove('vacp-inspector-resizing');
  };
}
