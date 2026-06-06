import type { ReactElement } from 'react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { createVacpDebugDock } from '@vacp/debug-ui/dock';
import { installVacpDebugResizer } from '@vacp/debug-ui/resize';
import { useVacpDebugUiStore, type VacpDebugModuleId } from '@vacp/debug-ui/overlay/debug-store';
import { ActionsModule } from '@vacp/debug-ui/overlay/modules/actions-module';
import { DataModule } from '@vacp/debug-ui/overlay/modules/data-module';
import { GraphModule } from '@vacp/debug-ui/overlay/modules/graph-module';
import { HistoryModule } from '@vacp/debug-ui/overlay/modules/history-module';
import { JsonModule } from '@vacp/debug-ui/overlay/modules/json-module';
import { SettingsModule } from '@vacp/debug-ui/overlay/modules/settings-module';
import { ChatModule } from '@vacp/debug-ui/overlay/modules/chat/chat-module';
import { useVacpBridge, useVacpBridgePresence, useVacpRuntime } from '@vacp/debug-ui/overlay/bridge-queries';
import { TooltipProvider } from '@vacp/debug-ui/ui/components/ui/tooltip';

import { DEBUG_UI_PANEL_BREAKPOINTS, isDenseDebugPanel } from './debug-ui-breakpoints';
import { DebugUiView, type VacpDebugBridgeStatus } from './debug-ui-view';
import { useElementSize } from './hooks/use-element-size';
import { useDebugPanelLayout } from './hooks/use-debug-panel-layout';

export function VacpDebugUiApp(props: { globalKey: string; includeActions: boolean }): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelHeaderRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  const open = useVacpDebugUiStore((s) => s.open);
  const moduleId = useVacpDebugUiStore((s) => s.moduleId);
  const setIncludeActionsDefault = useVacpDebugUiStore((s) => s.setIncludeActionsDefault);
  const setOpen = useVacpDebugUiStore((s) => s.setOpen);
  const setModuleId = useVacpDebugUiStore((s) => s.setModuleId);

  const [plotKey, setPlotKey] = useState(0);
  const [panelVisible, setPanelVisible] = useState(open);
  const [panelClosing, setPanelClosing] = useState(false);

  useEffect(() => {
    setIncludeActionsDefault(props.includeActions);
  }, [props.includeActions, setIncludeActionsDefault]);

  useEffect(() => {
    if (open) {
      setPanelVisible(true);
      setPanelClosing(false);
      return;
    }
    if (!panelVisible) return;
    setPanelClosing(true);
    const timeout = window.setTimeout(() => {
      setPanelVisible(false);
      setPanelClosing(false);
    }, 170);
    return () => window.clearTimeout(timeout);
  }, [open, panelVisible]);

  const bridgePresence = useVacpBridgePresence(props.globalKey);
  const bridgeQuery = useVacpBridge(props.globalKey, open);
  const runtimeQuery = useVacpRuntime(props.globalKey, bridgeQuery.data ?? null, open);
  const panelSize = useElementSize(panelRef);
  const compactPanel = panelSize.width < DEBUG_UI_PANEL_BREAKPOINTS.compactShell;
  const densePanel = isDenseDebugPanel(panelSize.width, panelSize.height);

  const bridgeRef = useRef(bridgeQuery.data ?? null);
  useEffect(() => {
    bridgeRef.current = bridgeQuery.data ?? null;
  }, [bridgeQuery.data]);

  const bridgeRefetchRef = useRef(bridgeQuery.refetch);
  useEffect(() => {
    bridgeRefetchRef.current = bridgeQuery.refetch;
  }, [bridgeQuery.refetch]);

  const runtimeRefetchRef = useRef(runtimeQuery.refetch);
  useEffect(() => {
    runtimeRefetchRef.current = runtimeQuery.refetch;
  }, [runtimeQuery.refetch]);

  const bridgeStatus: VacpDebugBridgeStatus = bridgePresence.data
    ? 'ok'
    : open && (bridgeQuery.isFetching || runtimeQuery.isFetching)
      ? 'unknown'
      : 'missing';

  const { maximized, panelPosition, minimize, toggleMaximize } = useDebugPanelLayout({
    rootRef,
    panelRef,
    open: panelVisible,
  });

  useLayoutEffect(() => {
    if (!panelVisible) return;
    panelPosition();
  }, [panelVisible, panelPosition, panelSize.height, panelSize.width]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const button = buttonRef.current;
    const header = panelHeaderRef.current;
    if (!root || !button) return;
    const handles: HTMLElement[] = header ? [button, header] : [button];
    const dock = createVacpDebugDock({
      root,
      handles,
      storageKey: 'vacp:debug:dock',
      onMove: () => panelPosition(),
      onDrop: () => panelPosition(),
    });
    dock.attach();
    // No cleanup: the overlay lives for the page lifetime.
  }, [panelPosition]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    installVacpDebugResizer({
      panel,
      storageKey: 'vacp:debug:size',
      onResize: () => panelPosition(),
      onResizeEnd: () => panelPosition(),
    });
  }, [panelPosition]);

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
        const b = bridgeRef.current;
        if (b && typeof b.refresh === 'function') void b.refresh({ source: 'debug', message: 'refresh' });
        void runtimeRefetchRef.current();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const pill = buttonRef.current;
    const panel = panelRef.current;
    if (open) {
      const focusActiveTab = () => {
        const activeTab = panel?.querySelector<HTMLElement>('.vacp-debug-ui-module[data-state="active"]');
        (activeTab ?? panel)?.focus?.();
      };
      panelPosition();
      const raf = window.requestAnimationFrame(() => {
        panelPosition();
        focusActiveTab();
      });
      const timeout = window.setTimeout(() => panelPosition(), 0);
      queueMicrotask(() => {
        panelPosition();
        focusActiveTab();
      });
      return () => {
        window.cancelAnimationFrame(raf);
        window.clearTimeout(timeout);
      };
    }
    // When closing, return focus back to the pill button for smooth keyboard operation.
    pill?.focus?.();
  }, [open, panelPosition]);

  useEffect(() => {
    const onPlotChange = () => {
      setPlotKey((x) => x + 1);
      useVacpDebugUiStore.getState().resetDataModule();
      void bridgeRefetchRef.current();
      void runtimeRefetchRef.current();
    };
    window.addEventListener('hashchange', onPlotChange);
    window.addEventListener('popstate', onPlotChange);
    return () => {
      window.removeEventListener('hashchange', onPlotChange);
      window.removeEventListener('popstate', onPlotChange);
    };
  }, []);

  const title = useMemo(() => `VACP Debug (${props.globalKey})`, [props.globalKey]);

  const meta = useMemo(() => {
    const rt = runtimeQuery.data;
    if (!rt) return '';
    const rid = (rt.runtimeId ?? '').toString().slice(0, 8);
    const cursor = Number.isFinite(rt.cursor) ? rt.cursor : -1;
    return [
      `v${rt.version}`,
      `mode=${rt.mode}`,
      `cursor=${cursor}`,
      `history=${rt.history.length}`,
      rid ? `runtime=${rid}` : null,
    ]
      .filter(Boolean)
      .join(' • ');
  }, [runtimeQuery.data]);

  const pillTitle =
    bridgeStatus === 'ok'
      ? 'VACP bridge attached (open debug tools)'
      : bridgeStatus === 'unknown'
        ? 'Checking for VACP bridge…'
        : 'No VACP bridge found (open debug tools)';

  const bridge = bridgeQuery.data ?? null;
  const runtime = runtimeQuery.data ?? null;
  const renderModule = (id: VacpDebugModuleId) => {
    if (id === 'settings') return <SettingsModule />;

    if (!bridge || !runtime) {
      if (!open) return null;
      if (bridgeQuery.isFetching || runtimeQuery.isFetching)
        return <div className="text-[11px] text-slate-100/80">Connecting…</div>;
      const err = (bridgeQuery.error ?? runtimeQuery.error) as Error | null;
      if (err) return <div className="text-[11px] text-slate-100/80">{String(err.message ?? err)}</div>;
      return (
        <div className="text-[11px] text-slate-100/80">
          Open the overlay on a VACP-enabled page to inspect the bridge.
        </div>
      );
    }

    const ctx = { bridge, runtime };
    if (id === 'graph') return <GraphModule {...ctx} />;
    if (id === 'data') return <DataModule key={plotKey} {...ctx} />;
    if (id === 'actions') return <ActionsModule {...ctx} />;
    if (id === 'history') return <HistoryModule {...ctx} />;
    if (id === 'chat') return <ChatModule {...ctx} />;
    return <JsonModule {...ctx} />;
  };

  return (
    <TooltipProvider delayDuration={250}>
      <DebugUiView
        rootRef={rootRef}
        buttonRef={buttonRef}
        panelRef={panelRef}
        panelHeaderRef={panelHeaderRef}
        titleId={titleId}
        open={open}
        panelVisible={panelVisible}
        panelClosing={panelClosing}
        setOpen={setOpen}
        moduleId={moduleId}
        setModuleId={setModuleId}
        compactPanel={compactPanel}
        densePanel={densePanel}
        bridgeStatus={bridgeStatus}
        pillTitle={pillTitle}
        title={title}
        meta={meta}
        maximized={maximized}
        minimize={minimize}
        toggleMaximize={toggleMaximize}
        bridge={bridge}
        runtime={runtime}
        renderModule={renderModule}
      />
    </TooltipProvider>
  );
}
