type Size = { width: number; height: number };
type ResizeMode = 'n' | 'e' | 'w' | 'ne' | 'nw';

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

function applySize(panel: HTMLElement, size: Size): Size {
  const maxW = Math.max(360, window.innerWidth - 28);
  const maxH = Math.max(260, window.innerHeight - 92);
  const next = {
    width: clamp(size.width, 360, maxW),
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
export function installVacpDebugResizer(args: {
  panel: HTMLElement;
  storageKey: string;
  onResize?: () => void;
  onResizeEnd?: () => void;
}) {
  const { panel, storageKey, onResize, onResizeEnd } = args;

  const initial = readSize(storageKey);
  if (initial) {
    queueMicrotask(() => {
      applySize(panel, initial);
      onResize?.();
    });
  }

  const createHandle = (dir: ResizeMode, cursor: string) => {
    const el = document.createElement('div');
    el.className = `vacp-debug-ui-resize-handle vacp-debug-ui-resize-${dir}`;
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

  const onMove = (ev: PointerEvent) => {
    if (!resizing) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    const wantsW = mode.includes('w');
    const wantsE = mode.includes('e');
    const wantsN = mode.includes('n');
    const width = wantsE ? startW + dx : wantsW ? startW - dx : startW;
    const height = wantsN ? startH - dy : startH;
    applySize(panel, { width, height });
    onResize?.();
  };

  const onUp = () => {
    if (!resizing) return;
    resizing = false;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    panel.classList.remove('vacp-debug-ui-resizing');
    const rect = panel.getBoundingClientRect();
    saveSize(storageKey, { width: rect.width, height: rect.height });
    onResizeEnd?.();
  };

  const begin = (ev: PointerEvent, nextMode: ResizeMode) => {
    if (ev.button !== 0) return;
    resizing = true;
    mode = nextMode;
    panel.classList.add('vacp-debug-ui-resizing');
    const rect = panel.getBoundingClientRect();
    startX = ev.clientX;
    startY = ev.clientY;
    startW = rect.width;
    startH = rect.height;
    panel.setPointerCapture?.(ev.pointerId);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    ev.preventDefault();
  };

  for (const { mode: handleMode, element } of handles) {
    element.addEventListener('pointerdown', (ev) => begin(ev, handleMode));
  }
}
