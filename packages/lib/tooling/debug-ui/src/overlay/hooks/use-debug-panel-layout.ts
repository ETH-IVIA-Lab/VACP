import { useCallback, useEffect, useLayoutEffect, type RefObject } from 'react';

const PANEL_MARGIN = 14;
const DOCK_GAP = 8;

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

type DockBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

function px(value: string): number | null {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function readDockBox(root: HTMLElement): DockBox {
  const dockRect = root.getBoundingClientRect();
  const left = px(root.style.left);
  const top = px(root.style.top);
  if (left === null || top === null) {
    return {
      left: dockRect.left,
      top: dockRect.top,
      right: dockRect.right,
      bottom: dockRect.bottom,
      width: dockRect.width,
      height: dockRect.height,
    };
  }
  return {
    left,
    top,
    right: left + dockRect.width,
    bottom: top + dockRect.height,
    width: dockRect.width,
    height: dockRect.height,
  };
}

function maxPanelHeight(root: HTMLElement): number {
  const dock = readDockBox(root);
  return Math.max(260, dock.top - DOCK_GAP - PANEL_MARGIN);
}

function panelLayoutSize(panel: HTMLElement): { width: number; height: number } {
  const rect = panel.getBoundingClientRect();
  return {
    width: panel.offsetWidth || rect.width,
    height: panel.offsetHeight || rect.height,
  };
}

export function useDebugPanelLayout(args: {
  rootRef: RefObject<HTMLDivElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  open: boolean;
}): {
  panelPosition: () => void;
} {
  const { rootRef, panelRef, open } = args;

  const panelPosition = useCallback(() => {
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!root || !panel) return;
    if (getComputedStyle(panel).display === 'none') return;

    const dock = readDockBox(root);
    const rect = panelLayoutSize(panel);
    const maxWidth = Math.max(360, window.innerWidth - PANEL_MARGIN * 2);
    const maxHeight = maxPanelHeight(root);
    const width = clamp(rect.width, 360, maxWidth);
    const height = clamp(rect.height, 260, maxHeight);
    if (Math.abs(width - rect.width) > 0.5) panel.style.width = `${width}px`;
    if (Math.abs(height - rect.height) > 0.5) panel.style.height = `${height}px`;

    const dockCenter = dock.left + dock.width / 2;
    const left = dockCenter - width / 2;
    const nextLeft = clamp(left, PANEL_MARGIN, Math.max(PANEL_MARGIN, window.innerWidth - width - PANEL_MARGIN));
    const nextTop = clamp(
      dock.top - DOCK_GAP - height,
      PANEL_MARGIN,
      Math.max(PANEL_MARGIN, dock.top - DOCK_GAP - height),
    );

    panel.style.left = `${nextLeft}px`;
    panel.style.top = `${nextTop}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }, [panelRef, rootRef]);

  useLayoutEffect(() => {
    if (!open) return;
    panelPosition();
    const raf = window.requestAnimationFrame(() => panelPosition());
    const timeout = window.setTimeout(() => panelPosition(), 0);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timeout);
    };
  }, [open, panelPosition]);

  useEffect(() => {
    const onResize = () => panelPosition();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [panelPosition]);

  return { panelPosition };
}
