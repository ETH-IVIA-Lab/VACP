import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

const PANEL_POS_KEY = 'vacp:debug:panelPos';

function readPanelPos(): { left: number; top: number } | null {
  try {
    const raw = localStorage.getItem(PANEL_POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { left?: unknown; top?: unknown };
    if (typeof parsed.left !== 'number' || typeof parsed.top !== 'number') return null;
    if (!Number.isFinite(parsed.left) || !Number.isFinite(parsed.top)) return null;
    return { left: parsed.left, top: parsed.top };
  } catch {
    return null;
  }
}

export function useDebugPanelLayout(args: {
  rootRef: RefObject<HTMLDivElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  open: boolean;
}): {
  maximized: boolean;
  panelPosition: () => void;
  minimize: () => void;
  toggleMaximize: () => void;
} {
  const { rootRef, panelRef, open } = args;
  const [maximized, setMaximized] = useState(false);
  const sizeBeforeMaxRef = useRef<{ width: number; height: number } | null>(null);

  const panelPosition = useCallback(() => {
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!root || !panel) return;
    if (getComputedStyle(panel).display === 'none') return;

    const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
    const margin = 10;
    const gap = 10;
    const panelRect = panel.getBoundingClientRect();
    const w = panelRect.width;
    const h = panelRect.height;

    const stored = readPanelPos();
    let left: number;
    let top: number;
    if (stored) {
      left = stored.left;
      top = stored.top;
    } else {
      const dockRect = root.getBoundingClientRect();
      const openRight = dockRect.left < window.innerWidth / 2;
      const openDown = dockRect.top < window.innerHeight / 2;
      left = openRight ? dockRect.left : dockRect.right - w;
      top = openDown ? dockRect.bottom + gap : dockRect.top - gap - h;
    }

    left = clamp(left, margin, Math.max(margin, window.innerWidth - w - margin));
    top = clamp(top, margin, Math.max(margin, window.innerHeight - h - margin));

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }, [panelRef, rootRef]);

  const applySize = useCallback(
    (size: { width: number; height: number }) => {
      const panel = panelRef.current;
      if (!panel) return;
      const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
      const maxW = Math.max(360, window.innerWidth - 28);
      const maxH = Math.max(260, window.innerHeight - 92);
      panel.style.width = `${clamp(size.width, 360, maxW)}px`;
      panel.style.height = `${clamp(size.height, 260, maxH)}px`;
    },
    [panelRef],
  );

  const minimize = useCallback(() => {
    setMaximized(false);
    sizeBeforeMaxRef.current = null;
    const panel = panelRef.current;
    if (!panel) return;
    panel.style.width = '';
    panel.style.height = '';
    try {
      localStorage.removeItem('vacp:debug:size');
    } catch {
      // ignore
    }
    panelPosition();
  }, [panelPosition, panelRef]);

  const toggleMaximize = useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (!maximized) {
      const rect = panel.getBoundingClientRect();
      sizeBeforeMaxRef.current = { width: rect.width, height: rect.height };
      setMaximized(true);
      applySize({ width: window.innerWidth - 28, height: window.innerHeight - 92 });
      panelPosition();
      return;
    }
    setMaximized(false);
    if (sizeBeforeMaxRef.current) applySize(sizeBeforeMaxRef.current);
    panelPosition();
  }, [applySize, maximized, panelPosition, panelRef]);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => panelPosition());
  }, [open, panelPosition]);

  useEffect(() => {
    const onResize = () => panelPosition();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [panelPosition]);

  return { maximized, panelPosition, minimize, toggleMaximize };
}

