export function installVacpDebugPanelDrag(args: {
  panel: HTMLElement;
  handle: HTMLElement;
  storageKey: string;
  onMove?: () => void;
}) {
  const { panel, handle, storageKey, onMove } = args;

  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
  const read = (): { left: number; top: number } | null => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { left?: unknown; top?: unknown };
      if (typeof parsed.left !== 'number' || typeof parsed.top !== 'number') return null;
      if (!Number.isFinite(parsed.left) || !Number.isFinite(parsed.top)) return null;
      return { left: parsed.left, top: parsed.top };
    } catch {
      return null;
    }
  };
  const save = (pos: { left: number; top: number }) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(pos));
    } catch {
      // ignore
    }
  };

  const apply = (pos: { left: number; top: number }) => {
    const rect = panel.getBoundingClientRect();
    const margin = 10;
    const left = clamp(pos.left, margin, Math.max(margin, window.innerWidth - rect.width - margin));
    const top = clamp(pos.top, margin, Math.max(margin, window.innerHeight - rect.height - margin));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  };

  const initial = read();
  if (initial) queueMicrotask(() => apply(initial));

  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  const shouldIgnoreTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    if (target.closest('[data-vacp-no-drag="1"]')) return true;
    return Boolean(target.closest('button, a, input, textarea, select, option, [role="button"]'));
  };

  const onMoveEv = (ev: PointerEvent) => {
    if (!dragging) return;
    const rect = panel.getBoundingClientRect();
    const margin = 10;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    const left = clamp(startLeft + dx, margin, Math.max(margin, window.innerWidth - rect.width - margin));
    const top = clamp(startTop + dy, margin, Math.max(margin, window.innerHeight - rect.height - margin));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    window.removeEventListener('pointermove', onMoveEv);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    panel.classList.remove('vacp-debug-ui-panel-dragging');
    const rect = panel.getBoundingClientRect();
    save({ left: rect.left, top: rect.top });
    onMove?.();
  };

  const onDown = (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    if (shouldIgnoreTarget(ev.target)) return;
    dragging = true;
    panel.classList.add('vacp-debug-ui-panel-dragging');
    const rect = panel.getBoundingClientRect();
    startX = ev.clientX;
    startY = ev.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    handle.setPointerCapture?.(ev.pointerId);
    window.addEventListener('pointermove', onMoveEv);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    ev.preventDefault();
  };

  handle.addEventListener('pointerdown', onDown);
}
