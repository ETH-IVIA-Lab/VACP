import type { ReactElement } from 'react';
import { useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';

import { createVacpInspectorDock } from '@vacp/inspector/dock';
import { installVacpInspectorResizer } from '@vacp/inspector/resize';
import { useVacpInspectorStore, type VacpInspectorModuleId } from '@vacp/inspector/overlay/inspector-store';
import { ActionsModule } from '@vacp/inspector/overlay/modules/actions-module';
import { DataModule } from '@vacp/inspector/overlay/modules/data-module';
import { GraphModule } from '@vacp/inspector/overlay/modules/graph-module';
import { HistoryModule } from '@vacp/inspector/overlay/modules/history-module';
import { JsonModule } from '@vacp/inspector/overlay/modules/json-module';
import { SettingsModule } from '@vacp/inspector/overlay/modules/settings-module';
import { ChatModule } from '@vacp/inspector/overlay/modules/chat/chat-module';
import { useVacpBridge, useVacpBridgePresence, useVacpRuntime } from '@vacp/inspector/overlay/bridge-queries';
import { useRuntimeHealth } from '@vacp/inspector/overlay/runtime-health';
import { TooltipProvider } from '@vacp/inspector/ui/components/ui/tooltip';

import { INSPECTOR_PANEL_BREAKPOINTS, isDenseInspectorPanel } from './inspector-breakpoints';
import { InspectorView, type VacpInspectorBridgeStatus } from './inspector-view';
import { useElementSize } from './hooks/use-element-size';
import { useInspectorPanelLayout } from './hooks/use-inspector-panel-layout';

type PanelTransition = { visible: boolean; closing: boolean };

type PanelTransitionAction = { type: 'open' } | { type: 'close' } | { type: 'closed' };

function panelTransitionReducer(state: PanelTransition, action: PanelTransitionAction): PanelTransition {
  if (action.type === 'open') {
    if (state.visible && !state.closing) return state;

    return { visible: true, closing: false };
  }

  if (action.type === 'close') {
    if (!state.visible) return state;

    return { visible: true, closing: true };
  }

  if (!state.closing) return state;

  return { visible: false, closing: false };
}

export function VacpInspectorApp(props: { globalKey: string; includeActions: boolean }): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelHeaderRef = useRef<HTMLDivElement | null>(null);
  const compactDragRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dockRef = useRef<ReturnType<typeof createVacpInspectorDock> | null>(null);
  const titleId = useId();

  const open = useVacpInspectorStore((s) => s.open);
  const moduleId = useVacpInspectorStore((s) => s.moduleId);
  const setIncludeActionsDefault = useVacpInspectorStore((s) => s.setIncludeActionsDefault);
  const setOpen = useVacpInspectorStore((s) => s.setOpen);
  const setModuleId = useVacpInspectorStore((s) => s.setModuleId);

  const [plotKey, setPlotKey] = useState(0);

  const [panelTransition, dispatchPanelTransition] = useReducer(panelTransitionReducer, {
    visible: open,
    closing: false,
  });

  useEffect(() => {
    setIncludeActionsDefault(props.includeActions);
  }, [props.includeActions, setIncludeActionsDefault]);

  useEffect(() => {
    dispatchPanelTransition({ type: open ? 'open' : 'close' });
  }, [open]);

  useEffect(() => {
    if (!panelTransition.closing) return;

    const timeout = window.setTimeout(() => {
      dispatchPanelTransition({ type: 'closed' });
    }, 170);

    return () => window.clearTimeout(timeout);
  }, [panelTransition.closing]);

  const bridgePresence = useVacpBridgePresence(props.globalKey);
  const bridgeQuery = useVacpBridge(props.globalKey, open);
  const runtimeQuery = useVacpRuntime(props.globalKey, bridgeQuery.data ?? null, open);
  const panelSize = useElementSize(panelRef);
  const compactPanel = panelSize.width < INSPECTOR_PANEL_BREAKPOINTS.compactShell;
  const densePanel = isDenseInspectorPanel(panelSize.width, panelSize.height);

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

  const bridgeStatus: VacpInspectorBridgeStatus = bridgePresence.data
    ? 'ok'
    : open && (bridgeQuery.isFetching || runtimeQuery.isFetching)
      ? 'unknown'
      : 'missing';

  const runtimeHealth = useRuntimeHealth({
    bridgeStatus,
    runtime: runtimeQuery.data ?? null,
    bridgeError: bridgeQuery.error,
    runtimeError: runtimeQuery.error,
  });

  const { panelPosition } = useInspectorPanelLayout({
    rootRef,
    panelRef,
    open: panelTransition.visible,
  });

  useLayoutEffect(() => {
    if (!panelTransition.visible) return;
    panelPosition();
  }, [panelTransition.visible, panelPosition, panelSize.height, panelSize.width]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const button = buttonRef.current;
    const header = panelHeaderRef.current;
    const compactDrag = compactDragRef.current;

    if (!root || !button) return;
    const handles: HTMLElement[] = header ? [button, header] : [button];

    if (compactDrag) handles.push(compactDrag);

    const dock = createVacpInspectorDock({
      root,
      handles,
      storageKey: 'vacp:inspector:dock',
      onMove: () => panelPosition(),
      onDrop: () => panelPosition(),
    });

    dockRef.current = dock;
    dock.attach();
    // The overlay stays mounted for the page lifetime.
  }, [panelPosition]);

  useLayoutEffect(() => {
    if (!panelTransition.visible) return;
    const dock = dockRef.current;

    if (!dock) return;
    const header = panelHeaderRef.current;
    const compactDrag = compactDragRef.current;

    if (header) dock.addHandle(header);

    if (compactDrag) dock.addHandle(compactDrag);
  }, [compactPanel, panelTransition.visible]);

  useLayoutEffect(() => {
    const panel = panelRef.current;

    if (!panel) return;
    installVacpInspectorResizer({
      panel,
      storageKey: 'vacp:inspector:size',
      onResize: () => panelPosition(),
      onResizeEnd: () => panelPosition(),
    });
  }, [panelPosition]);

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      const { open: isOpen } = useVacpInspectorStore.getState();

      if (!isOpen) return;
      const tag = (ev.target as HTMLElement | null)?.tagName?.toLowerCase?.() ?? '';

      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (ev.key === 'Escape') {
        ev.preventDefault();
        useVacpInspectorStore.getState().setOpen(false);

        return;
      }

      if (!ev.altKey) return;

      if (ev.key.toLowerCase() === 'r') {
        ev.preventDefault();
        const b = bridgeRef.current;

        if (b && typeof b.refresh === 'function') void b.refresh({ source: 'inspector', message: 'refresh' });
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
        const activeTab = panel?.querySelector<HTMLElement>('.vacp-inspector-module[data-state="active"]');
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
      useVacpInspectorStore.getState().resetDataModule();
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
      .join(' / ');
  }, [runtimeQuery.data]);

  const dockAction = open ? 'close inspector' : 'open inspector';

  const pillTitle =
    bridgeStatus === 'ok'
      ? `VACP bridge attached (${dockAction})`
      : bridgeStatus === 'unknown'
        ? 'Checking for VACP bridge...'
        : `No VACP bridge found (${dockAction})`;

  const bridge = bridgeQuery.data ?? null;
  const runtime = runtimeQuery.data ?? null;

  const renderModule = (id: VacpInspectorModuleId) => {
    if (id === 'settings') return <SettingsModule />;

    if (!bridge || !runtime) {
      if (!open) return null;

      if (bridgeQuery.isFetching || runtimeQuery.isFetching)
        return <div className="text-[11px] text-slate-100/80">Connecting...</div>;
      const err = bridgeQuery.error ?? runtimeQuery.error;

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
      <InspectorView
        rootRef={rootRef}
        buttonRef={buttonRef}
        panelRef={panelRef}
        panelHeaderRef={panelHeaderRef}
        compactDragRef={compactDragRef}
        titleId={titleId}
        open={open}
        panelVisible={panelTransition.visible}
        panelClosing={panelTransition.closing}
        setOpen={setOpen}
        moduleId={moduleId}
        setModuleId={setModuleId}
        compactPanel={compactPanel}
        densePanel={densePanel}
        bridgeStatus={bridgeStatus}
        pillTitle={pillTitle}
        meta={meta}
        bridge={bridge}
        runtime={runtime}
        runtimeHealth={runtimeHealth}
        renderModule={renderModule}
      />
    </TooltipProvider>
  );
}
