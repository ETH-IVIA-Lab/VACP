import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

const PANEL_MARGIN = 14;
const DOCK_GAP = 8;
const CONNECTOR_WIDTH = 4;

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
  connectorRef?: RefObject<HTMLDivElement | null>;
  open: boolean;
}): {
  maximized: boolean;
  panelPosition: () => void;
  minimize: () => void;
  toggleMaximize: () => void;
} {
  const { rootRef, panelRef, connectorRef, open } = args;
  const [maximized, setMaximized] = useState(false);
  const sizeBeforeMaxRef = useRef<{ width: number; height: number } | null>(null);

  const panelPosition = useCallback(() => {
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!root || !panel) return;
    if (getComputedStyle(panel).display === 'none') {
      const connector = connectorRef?.current;
      if (connector) connector.style.height = '0px';
      return;
    }

    const dock = readDockBox(root);
    const rect = panelLayoutSize(panel);
    const maxWidth = Math.max(360, window.innerWidth - PANEL_MARGIN * 2);
    const maxHeight = maxPanelHeight(root);
    const width = clamp(rect.width, 360, maxWidth);
    const height = clamp(rect.height, 260, maxHeight);
    if (Math.abs(width - rect.width) > 0.5) panel.style.width = `${width}px`;
    if (Math.abs(height - rect.height) > 0.5) panel.style.height = `${height}px`;

    const dockCenter = dock.left + dock.width / 2;
    const left =
      dockCenter < window.innerWidth * 0.34
        ? dock.left
        : dockCenter > window.innerWidth * 0.66
          ? dock.right - width
          : dockCenter - width / 2;
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

    const connector = connectorRef?.current;
    if (!connector) return;
    const panelBottom = nextTop + height;
    const connectorX = clamp(dockCenter, nextLeft + 20, nextLeft + width - 20);
    connector.style.width = `${CONNECTOR_WIDTH}px`;
    connector.style.left = `${connectorX - CONNECTOR_WIDTH / 2}px`;
    connector.style.top = `${panelBottom}px`;
    connector.style.height = `${Math.max(0, dock.top - panelBottom)}px`;
  }, [connectorRef, panelRef, rootRef]);

  const applySize = useCallback(
    (size: { width: number; height: number }) => {
      const root = rootRef.current;
      const panel = panelRef.current;
      if (!root || !panel) return;
      const maxW = Math.max(360, window.innerWidth - PANEL_MARGIN * 2);
      const maxH = maxPanelHeight(root);
      panel.style.width = `${clamp(size.width, 360, maxW)}px`;
      panel.style.height = `${clamp(size.height, 260, maxH)}px`;
      panelPosition();
    },
    [panelPosition, panelRef, rootRef],
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
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!root || !panel) return;
    if (!maximized) {
      const rect = panelLayoutSize(panel);
      sizeBeforeMaxRef.current = { width: rect.width, height: rect.height };
      setMaximized(true);
      applySize({ width: window.innerWidth - PANEL_MARGIN * 2, height: maxPanelHeight(root) });
      return;
    }
    setMaximized(false);
    if (sizeBeforeMaxRef.current) applySize(sizeBeforeMaxRef.current);
    panelPosition();
  }, [applySize, maximized, panelPosition, panelRef, rootRef]);

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

  return { maximized, panelPosition, minimize, toggleMaximize };
}
