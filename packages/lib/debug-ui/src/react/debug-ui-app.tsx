import { Braces, Database, GitGraph, History, ListOrdered, Maximize2, Minimize2, Shrink, X, Zap } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { getBridge, readPlaybooks, readRuntime } from '../bridge';
import { createVacpDebugDock } from '../dock';
import { installVacpDebugResizer } from '../resize';
import { IconButton } from './icon-button';
import { useVacpDebugUiStore, type VacpDebugBridgeStatus, type VacpDebugModuleId } from './debug-store';
import { ActionsModule } from './modules/actions-module';
import { DataModule } from './modules/data-module';
import { GraphModule } from './modules/graph-module';
import { HistoryModule } from './modules/history-module';
import { JsonModule } from './modules/json-module';
import { PlaybookModule } from './modules/playbook-module';

export function VacpDebugUiApp(props: { globalKey: string; includeActions: boolean }): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const open = useVacpDebugUiStore((s) => s.open);
  const moduleId = useVacpDebugUiStore((s) => s.moduleId);
  const bridgeStatus = useVacpDebugUiStore((s) => s.bridgeStatus);
  const bridge = useVacpDebugUiStore((s) => s.bridge);
  const runtime = useVacpDebugUiStore((s) => s.runtime);
  const playbooks = useVacpDebugUiStore((s) => s.playbooks);
  const error = useVacpDebugUiStore((s) => s.error);

  const setGlobalKey = useVacpDebugUiStore((s) => s.setGlobalKey);
  const setIncludeActionsDefault = useVacpDebugUiStore((s) => s.setIncludeActionsDefault);
  const setOpen = useVacpDebugUiStore((s) => s.setOpen);
  const setModuleId = useVacpDebugUiStore((s) => s.setModuleId);
  const setBridgeStatus = useVacpDebugUiStore((s) => s.setBridgeStatus);
  const setBridge = useVacpDebugUiStore((s) => s.setBridge);
  const setRuntime = useVacpDebugUiStore((s) => s.setRuntime);
  const setPlaybooks = useVacpDebugUiStore((s) => s.setPlaybooks);
  const setError = useVacpDebugUiStore((s) => s.setError);

  const [maximized, setMaximized] = useState(false);
  const sizeBeforeMaxRef = useRef<{ width: number; height: number } | null>(null);
  const unsubscribeRef = useRef<null | (() => void)>(null);
  const bridgeRetryTimerRef = useRef<number | null>(null);
  const bridgeRetryCountRef = useRef(0);

  useEffect(() => {
    setGlobalKey(props.globalKey);
    setIncludeActionsDefault(props.includeActions);
  }, [props.globalKey, props.includeActions, setGlobalKey, setIncludeActionsDefault]);

  const updateBridgeIndicator = (status: VacpDebugBridgeStatus) => setBridgeStatus(status);

  const panelPosition = () => {
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!root || !panel) return;
    if (getComputedStyle(panel).display === 'none') return;

    const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
    const margin = 10;
    const gap = 10;
    const dockRect = root.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const w = panelRect.width;
    const h = panelRect.height;

    const openRight = dockRect.left < window.innerWidth / 2;
    const openDown = dockRect.top < window.innerHeight / 2;
    let left = openRight ? dockRect.left : dockRect.right - w;
    let top = openDown ? dockRect.bottom + gap : dockRect.top - gap - h;

    left = clamp(left, margin, Math.max(margin, window.innerWidth - w - margin));
    top = clamp(top, margin, Math.max(margin, window.innerHeight - h - margin));

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  };

  const applySize = (size: { width: number; height: number }) => {
    const panel = panelRef.current;
    if (!panel) return;
    const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
    const maxW = Math.max(360, window.innerWidth - 28);
    const maxH = Math.max(260, window.innerHeight - 92);
    panel.style.width = `${clamp(size.width, 360, maxW)}px`;
    panel.style.height = `${clamp(size.height, 260, maxH)}px`;
    try {
      localStorage.setItem('vacp:debug:size', JSON.stringify({ width: panel.getBoundingClientRect().width, height: panel.getBoundingClientRect().height }));
    } catch {
      // ignore
    }
  };

  const resetSize = () => {
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
  };

  const toggleMaximize = () => {
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
  };

  const connect = async () => {
    updateBridgeIndicator('unknown');
    const b = getBridge(props.globalKey);
    if (!b) {
      setBridge(null);
      setRuntime(null);
      setPlaybooks([]);
      setError(`No VACP bridge found (expected window.${props.globalKey}).`);
      updateBridgeIndicator('missing');
      if (bridgeRetryTimerRef.current) window.clearTimeout(bridgeRetryTimerRef.current);
      bridgeRetryTimerRef.current = window.setTimeout(() => {
        bridgeRetryTimerRef.current = null;
        if (!useVacpDebugUiStore.getState().open) return;
        bridgeRetryCountRef.current += 1;
        if (bridgeRetryCountRef.current > 25) return;
        void connect();
      }, 400);
      return;
    }

    bridgeRetryCountRef.current = 0;
    if (bridgeRetryTimerRef.current) window.clearTimeout(bridgeRetryTimerRef.current);
    bridgeRetryTimerRef.current = null;

    setError(null);
    setBridge(b);
    updateBridgeIndicator('ok');

    const [rt, pbs] = await Promise.all([readRuntime(b), readPlaybooks(b)]);
    setRuntime(rt);
    setPlaybooks(pbs);

    if (typeof b.subscribe === 'function') {
      unsubscribeRef.current?.();
      unsubscribeRef.current = b.subscribe(async () => {
        try {
          const next = await readRuntime(b);
          setRuntime(next);
        } catch {
          // ignore
        }
      });
    }
  };

  // Initial status: if the bridge is already present, show green immediately.
  useEffect(() => {
    updateBridgeIndicator(getBridge(props.globalKey) ? 'ok' : 'missing');
    if (getBridge(props.globalKey)) return;
    const start = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - start > 15_000) {
        window.clearInterval(timer);
        return;
      }
      if (getBridge(props.globalKey)) {
        updateBridgeIndicator('ok');
        window.clearInterval(timer);
      }
    }, 350);
    return () => window.clearInterval(timer);
  }, [props.globalKey]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const button = buttonRef.current;
    if (!root || !button) return;
    const dock = createVacpDebugDock({
      root,
      handles: [button],
      storageKey: 'vacp:debug:pos',
      onMove: () => panelPosition(),
      onDrop: () => panelPosition(),
    });
    dock.attach();
    // No cleanup: the overlay lives for the page lifetime.
  }, []);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    installVacpDebugResizer({
      panel,
      storageKey: 'vacp:debug:size',
      onResizeEnd: () => panelPosition(),
    });
  }, []);

  useEffect(() => {
    const onResize = () => panelPosition();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      const { open: isOpen } = useVacpDebugUiStore.getState();
      if (!isOpen) return;
      const tag = (ev.target as HTMLElement | null)?.tagName?.toLowerCase?.() ?? '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (ev.key === 'Escape') {
        ev.preventDefault();
        useVacpDebugUiStore.getState().setOpen(false);
        return;
      }

      if (!ev.altKey) return;

      if (ev.key.toLowerCase() === 'r') {
        ev.preventDefault();
        const b = getBridge(props.globalKey);
        if (!b || typeof b.refresh !== 'function') return;
        void b.refresh({ source: 'debug', message: 'refresh' });
        return;
      }

      const n = Number(ev.key);
      if (!Number.isFinite(n) || n <= 0) return;
      const ids: VacpDebugModuleId[] = ['graph', 'data', 'actions', 'history', 'playbook', 'json'];
      const id = ids[n - 1];
      if (!id) return;
      ev.preventDefault();
      useVacpDebugUiStore.getState().setModuleId(id);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [props.globalKey]);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => panelPosition());
    void connect();
  }, [open]);

  useEffect(() => {
    return () => {
      unsubscribeRef.current?.();
      if (bridgeRetryTimerRef.current) window.clearTimeout(bridgeRetryTimerRef.current);
      bridgeRetryTimerRef.current = null;
    };
  }, []);

  const title = useMemo(() => {
    const rt = runtime;
    if (!rt) return `VACP Debug (${props.globalKey})`;
    const rid = (rt.runtimeId ?? '').toString().slice(0, 8);
    return `VACP Debug (${props.globalKey}) • mode=${rt.mode} cursor=${rt.cursor} history=${rt.history.length} • runtime=${rid}`;
  }, [props.globalKey, runtime]);

  const pillTitle =
    bridgeStatus === 'ok'
      ? 'VACP bridge attached (open debug tools)'
      : bridgeStatus === 'unknown'
        ? 'Checking for VACP bridge…'
        : 'No VACP bridge found (open debug tools)';

  const modules: { id: VacpDebugModuleId; title: string; icon: ReactElement }[] = useMemo(
    () => [
      { id: 'graph', title: 'Graph', icon: <GitGraph className="vacp-debug-ui-icon" size={16} /> },
      { id: 'data', title: 'Data', icon: <Database className="vacp-debug-ui-icon" size={16} /> },
      { id: 'actions', title: 'Actions', icon: <Zap className="vacp-debug-ui-icon" size={16} /> },
      { id: 'history', title: 'History', icon: <History className="vacp-debug-ui-icon" size={16} /> },
      { id: 'playbook', title: 'Playbook', icon: <ListOrdered className="vacp-debug-ui-icon" size={16} /> },
      { id: 'json', title: 'JSON', icon: <Braces className="vacp-debug-ui-icon" size={16} /> },
    ],
    [],
  );

  const content = (() => {
    if (!bridge || !runtime) {
      return <div className="vacp-debug-ui-small">{error ?? 'Connect to a VACP bridge to use debug tools.'}</div>;
    }
    const ctx = { bridge, runtime, playbooks };
    if (moduleId === 'graph') return <GraphModule {...ctx} />;
    if (moduleId === 'data') return <DataModule {...ctx} />;
    if (moduleId === 'actions') return <ActionsModule {...ctx} />;
    if (moduleId === 'history') return <HistoryModule {...ctx} />;
    if (moduleId === 'playbook') return <PlaybookModule {...ctx} />;
    return <JsonModule {...ctx} />;
  })();

  return (
    <>
      <div id="vacp-debug-ui-root" data-vacp-debug-ui="1" className="vacp-debug-ui-root" ref={rootRef}>
        <button
          ref={buttonRef}
          type="button"
          className="vacp-debug-ui-button"
          data-bridge={bridgeStatus}
          title={pillTitle}
          onClick={() => setOpen(!open)}
        >
          VACP
        </button>
      </div>

      <div
        id="vacp-debug-ui-panel"
        className="vacp-debug-ui-panel"
        ref={panelRef}
        style={{ display: open ? 'grid' : 'none', background: '#0b1020', color: '#e7e9ee' }}
      >
        <header className="vacp-debug-ui-header">
          <div className="vacp-debug-ui-title">{title}</div>
          <div className="vacp-debug-ui-header-actions">
            <IconButton
              icon={
                maximized ? (
                  <Minimize2 className="vacp-debug-ui-icon" size={16} />
                ) : (
                  <Maximize2 className="vacp-debug-ui-icon" size={16} />
                )
              }
              label={maximized ? 'Restore' : 'Maximize'}
              title={maximized ? 'Restore the previous overlay size.' : 'Toggle a near-fullscreen overlay size.'}
              onClick={() => toggleMaximize()}
            />
            <IconButton
              icon={<Shrink className="vacp-debug-ui-icon" size={16} />}
              label="Reset size"
              title="Reset overlay size back to its default."
              onClick={() => resetSize()}
            />
            <IconButton
              icon={<X className="vacp-debug-ui-icon" size={16} />}
              label="Close"
              title="Close debug tools (Esc)"
              variant="danger"
              onClick={() => setOpen(false)}
            />
          </div>
        </header>

        <div className="vacp-debug-ui-shell">
          <nav className="vacp-debug-ui-nav">
            <div className="vacp-debug-ui-nav-list">
              {modules.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="vacp-debug-ui-module"
                  aria-current={m.id === moduleId ? 'true' : 'false'}
                  title={m.title}
                  onClick={() => setModuleId(m.id)}
                >
                  {m.icon}
                  <span>{m.title}</span>
                </button>
              ))}
            </div>
          </nav>

          <div className="vacp-debug-ui-content">{content}</div>
        </div>
      </div>
    </>
  );
}
