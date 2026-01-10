import { Braces, Database, Eye, EyeOff, GitGraph, History, ListOrdered, Minus, Plus, X, Zap } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { createVacpDebugDock } from '@vacp/debug-ui/dock';
import { installVacpDebugPanelDrag } from '@vacp/debug-ui/panel-drag';
import { installVacpDebugResizer } from '@vacp/debug-ui/resize';
import { useVacpDebugUiStore, type VacpDebugModuleId } from '@vacp/debug-ui/overlay/debug-store';
import { IconButton } from '@vacp/debug-ui/overlay/icon-button';
import { ActionsModule } from '@vacp/debug-ui/overlay/modules/actions-module';
import { DataModule } from '@vacp/debug-ui/overlay/modules/data-module';
import { GraphModule } from '@vacp/debug-ui/overlay/modules/graph-module';
import { HistoryModule } from '@vacp/debug-ui/overlay/modules/history-module';
import { JsonModule } from '@vacp/debug-ui/overlay/modules/json-module';
import { PlaybookModule } from '@vacp/debug-ui/overlay/modules/playbook-module';
import { useVacpBridge, useVacpBridgePresence, useVacpPlaybooks, useVacpRuntime } from '@vacp/debug-ui/overlay/bridge-queries';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@vacp/debug-ui/ui/components/ui/tabs';
import { TooltipProvider } from '@vacp/debug-ui/ui/components/ui/tooltip';
import { cn } from '@vacp/debug-ui/ui/lib/utils';

import { useElementSize } from './hooks/use-element-size';

type VacpDebugBridgeStatus = 'missing' | 'unknown' | 'ok';

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

  const [maximized, setMaximized] = useState(false);
  const sizeBeforeMaxRef = useRef<{ width: number; height: number } | null>(null);

  useEffect(() => {
    setIncludeActionsDefault(props.includeActions);
  }, [props.includeActions, setIncludeActionsDefault]);

  const bridgePresence = useVacpBridgePresence(props.globalKey);
  const bridgeQuery = useVacpBridge(props.globalKey, open);
  const runtimeQuery = useVacpRuntime(props.globalKey, bridgeQuery.data ?? null, open);
  const playbooksQuery = useVacpPlaybooks(props.globalKey, bridgeQuery.data ?? null, open);

  const panelSize = useElementSize(panelRef);
  const compactPanel = panelSize.width < 720;
  const densePanel = panelSize.width < 520 || panelSize.height < 360;

  const bridgeRef = useRef(bridgeQuery.data ?? null);
  useEffect(() => {
    bridgeRef.current = bridgeQuery.data ?? null;
  }, [bridgeQuery.data]);

  const runtimeRefetchRef = useRef(runtimeQuery.refetch);
  useEffect(() => {
    runtimeRefetchRef.current = runtimeQuery.refetch;
  }, [runtimeQuery.refetch]);

  const bridgeStatus: VacpDebugBridgeStatus = bridgePresence.data
    ? 'ok'
    : open && (bridgeQuery.isFetching || runtimeQuery.isFetching)
      ? 'unknown'
      : 'missing';

  const PANEL_POS_KEY = 'vacp:debug:panelPos';

  const readPanelPos = (): { left: number; top: number } | null => {
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
  };

  const panelPosition = () => {
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
  };

  const applySize = (size: { width: number; height: number }) => {
    const panel = panelRef.current;
    if (!panel) return;
    const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
    const maxW = Math.max(360, window.innerWidth - 28);
    const maxH = Math.max(260, window.innerHeight - 92);
    panel.style.width = `${clamp(size.width, 360, maxW)}px`;
    panel.style.height = `${clamp(size.height, 260, maxH)}px`;
  };

  const minimize = () => {
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
      positionStorageKey: PANEL_POS_KEY,
      onResizeEnd: () => panelPosition(),
    });
  }, []);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const header = panelHeaderRef.current;
    if (!panel || !header) return;
    installVacpDebugPanelDrag({
      panel,
      handle: header,
      storageKey: PANEL_POS_KEY,
      onMove: () => panelPosition(),
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
        const b = bridgeRef.current;
        if (b && typeof b.refresh === 'function') void b.refresh({ source: 'debug', message: 'refresh' });
        void runtimeRefetchRef.current();
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
  }, []);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => panelPosition());
  }, [open]);

  useEffect(() => {
    const pill = buttonRef.current;
    const panel = panelRef.current;
    if (open) {
      queueMicrotask(() => {
        const activeTab = panel?.querySelector<HTMLElement>('.vacp-debug-ui-module[data-state="active"]');
        (activeTab ?? panel)?.focus?.();
      });
      return;
    }
    // When closing, return focus back to the pill button for smooth keyboard operation.
    pill?.focus?.();
  }, [open]);

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

  const modules: { id: VacpDebugModuleId; title: string; icon: ReactElement }[] = useMemo(
    () => [
      { id: 'graph', title: 'Graph', icon: <GitGraph className="h-4 w-4 text-slate-100/85" /> },
      { id: 'data', title: 'Data', icon: <Database className="h-4 w-4 text-slate-100/85" /> },
      { id: 'actions', title: 'Actions', icon: <Zap className="h-4 w-4 text-slate-100/85" /> },
      { id: 'history', title: 'History', icon: <History className="h-4 w-4 text-slate-100/85" /> },
      { id: 'playbook', title: 'Playbook', icon: <ListOrdered className="h-4 w-4 text-slate-100/85" /> },
      { id: 'json', title: 'JSON', icon: <Braces className="h-4 w-4 text-slate-100/85" /> },
    ],
    [],
  );

  const bridge = bridgeQuery.data ?? null;
  const runtime = runtimeQuery.data ?? null;
  const playbooks = playbooksQuery.data ?? [];

  const renderModule = (id: VacpDebugModuleId) => {
    if (!bridge || !runtime) {
      if (!open) return null;
      if (bridgeQuery.isFetching || runtimeQuery.isFetching) return <div className="text-[11px] text-slate-100/80">Connecting…</div>;
      const err = (bridgeQuery.error ?? runtimeQuery.error) as Error | null;
      if (err) return <div className="text-[11px] text-slate-100/80">{String(err.message ?? err)}</div>;
      return <div className="text-[11px] text-slate-100/80">Open the overlay on a VACP-enabled page to inspect the bridge.</div>;
    }

    const ctx = { bridge, runtime, playbooks };
    if (id === 'graph') return <GraphModule {...ctx} />;
    if (id === 'data') return <DataModule {...ctx} />;
    if (id === 'actions') return <ActionsModule {...ctx} />;
    if (id === 'history') return <HistoryModule {...ctx} />;
    if (id === 'playbook') return <PlaybookModule {...ctx} />;
    return <JsonModule {...ctx} />;
  };

  const inspectBanner = useMemo(() => {
    const rt = runtimeQuery.data;
    const bridge = bridgeQuery.data ?? null;
    if (!rt || !bridge) return null;
    if (rt.mode !== 'inspect') return null;
    const cursor = Number.isFinite(rt.cursor) ? rt.cursor : -1;
    const entry = cursor >= 0 && cursor < rt.history.length ? rt.history[cursor] : null;
    const at = entry?.at ? new Date(entry.at).toLocaleTimeString() : '';
    const msg = entry?.message ?? null;
    return (
      <div className="mb-3 rounded-lg border border-amber-300/25 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-50/85">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-semibold text-amber-50/90">Inspect mode (time travel)</div>
          <div className="text-amber-50/70">
            cursor {cursor} / {Math.max(0, rt.history.length - 1)}
            {at ? ` • ${at}` : ''}
            {msg ? ` • ${msg}` : ''}
          </div>
          <div className="flex-1" />
          <button
            type="button"
            className="rounded-md border border-amber-300/25 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-50/85 hover:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/40"
            onClick={() => setModuleId('history')}
          >
            Open history
          </button>
        </div>
        <div className="mt-1 text-amber-50/70">
          Panels show the state at the cursor. If supported, moving the cursor also replays that state into the host app (via <code>vacp.apply_state</code>).
        </div>
      </div>
    );
  }, [bridgeQuery.data, runtimeQuery.data, setModuleId]);

  const modeHelp = (
    <div className="max-w-[320px] text-[12px] leading-5 text-slate-100/85">
      <div className="font-semibold text-slate-100/90">Live</div>
      <div>Panels follow the latest provider snapshots (what the app is doing now).</div>
      <div className="mt-2 font-semibold text-slate-100/90">Inspect (time travel)</div>
      <div>Panels show the state at the history cursor. If supported, cursor changes also replay state into the host app.</div>
      <div className="mt-2">Use the History module to move the cursor and replay/inspect past snapshots.</div>
      <div className="mt-2">Tip: switch back to Live to resume tracking new snapshots.</div>
    </div>
  );

  const modeToggle = useMemo(() => {
    const rt = runtimeQuery.data;
    const bridge = bridgeQuery.data ?? null;
    if (!rt || !bridge) return null;
    const inspect = rt.mode === 'inspect';
    return (
      <IconButton
        icon={inspect ? <EyeOff className="h-4 w-4 text-slate-100/90" /> : <Eye className="h-4 w-4 text-slate-100/90" />}
        label="Toggle live/inspect mode"
        title={modeHelp}
        pressed={inspect}
        size="iconSm"
        onClick={() => {
          const next = inspect ? 'live' : 'inspect';
          bridge.setMode?.(next, { source: 'debug', message: `mode=${next}` });
        }}
      />
    );
  }, [bridgeQuery.data, modeHelp, runtimeQuery.data]);

  const dotClass =
    bridgeStatus === 'ok'
      ? 'bg-emerald-300'
      : bridgeStatus === 'unknown'
        ? 'bg-amber-300'
        : 'bg-white/40';

  return (
    <TooltipProvider delayDuration={250}>
      <div data-vacp-debug-ui="1">
        <div
          id="vacp-debug-ui-root"
          className="vacp-debug-ui-root fixed z-[2147483000] isolate touch-none"
          ref={rootRef}
        >
        <button
          ref={buttonRef}
          type="button"
          className="vacp-debug-ui-button inline-flex select-none items-center gap-2 rounded-full border border-white/20 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-100 shadow-[0_8px_24px_rgba(0,0,0,0.25)] cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
          data-bridge={bridgeStatus}
          title={pillTitle}
          onClick={() => setOpen(!open)}
        >
          <span>VACP</span>
          <span className={cn('h-2 w-2 rounded-full ring-2 ring-slate-950', dotClass)} aria-hidden="true" />
        </button>
      </div>

      <div
        id="vacp-debug-ui-panel"
        className={cn(
          'vacp-debug-ui-panel fixed z-[2147483001] grid h-[min(680px,calc(100vh-92px))] w-[min(860px,calc(100vw-28px))] overflow-hidden rounded-xl border border-white/20 bg-slate-950 text-slate-100 shadow-[0_16px_40px_rgba(0,0,0,0.35)]',
          'grid-rows-[auto_minmax(0,1fr)]',
          densePanel && 'vacp-debug-ui-dense',
        )}
        ref={panelRef}
        style={{ display: open ? 'grid' : 'none' }}
        data-vacp-debug-ui="1"
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div
          ref={panelHeaderRef}
          className={cn(
            'vacp-debug-ui-topbar',
            'flex h-11 items-center gap-3 border-b border-white/10',
            'bg-gradient-to-b from-slate-950/90 to-slate-950',
            'px-3 py-2',
          )}
        >
          <div className="group flex items-center gap-2">
            <button
              type="button"
              aria-label="Close"
              title="Close"
              className={cn(
                'relative grid h-3.5 w-3.5 place-items-center rounded-full bg-[#ff5f57]',
                'shadow-[inset_0_0_0_1px_rgba(0,0,0,0.18)]',
                'hover:brightness-[0.98] active:brightness-[0.96]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950',
              )}
              onClick={() => setOpen(false)}
            >
              <X
                className="h-2.5 w-2.5 text-black/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              aria-label="Minimize"
              title="Restore to the default panel size."
              className={cn(
                'relative grid h-3.5 w-3.5 place-items-center rounded-full bg-[#febc2e]',
                'shadow-[inset_0_0_0_1px_rgba(0,0,0,0.18)]',
                'hover:brightness-[0.98] active:brightness-[0.96]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950',
              )}
              onClick={() => minimize()}
            >
              <Minus
                className="h-3 w-3 text-black/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              aria-label={maximized ? 'Restore size' : 'Maximize'}
              title={maximized ? 'Restore size' : 'Maximize'}
              className={cn(
                'relative grid h-3.5 w-3.5 place-items-center rounded-full bg-[#28c840]',
                'shadow-[inset_0_0_0_1px_rgba(0,0,0,0.18)]',
                'hover:brightness-[0.98] active:brightness-[0.96]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950',
              )}
              onClick={() => toggleMaximize()}
            >
              <Plus
                className="h-3 w-3 text-black/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                aria-hidden="true"
              />
            </button>
          </div>

          <div id={titleId} className="min-w-0 flex-1">
            <div className="vacp-debug-ui-title truncate text-xs text-slate-100/85">{title}</div>
            {meta ? (
              <div className="vacp-debug-ui-meta truncate text-[10px] text-slate-100/55 [font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation_Mono','Courier_New',monospace]">
                {meta}
              </div>
            ) : null}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {modeToggle}
          </div>
        </div>

        <Tabs
          value={moduleId}
          onValueChange={(v) => setModuleId(v as VacpDebugModuleId)}
          orientation={compactPanel ? 'horizontal' : 'vertical'}
          activationMode="manual"
          className={cn('grid min-h-0', compactPanel ? 'grid-rows-[auto_minmax(0,1fr)]' : 'grid-cols-[180px_1fr] grid-rows-none')}
        >
          <nav
            className={cn(
              'min-h-0 max-w-full bg-white/5',
              densePanel ? 'p-1.5' : 'p-2',
              compactPanel ? 'overflow-x-auto border-b border-white/10' : 'overflow-y-auto border-b-0 border-r border-white/10',
            )}
            aria-label="VACP debug modules"
          >
            <TabsList loop className={cn('vacp-debug-ui-nav-list gap-1', compactPanel ? 'flex-row' : 'flex-col')}>
              {modules.map((m) => (
                <TabsTrigger
                  key={m.id}
                  value={m.id}
                  className={cn('vacp-debug-ui-module whitespace-nowrap', compactPanel ? 'w-auto' : 'w-full')}
                  title={m.title}
                >
                  {m.icon}
                  <span>{m.title}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </nav>

          <div className={cn('vacp-debug-ui-content min-h-0 min-w-0 overflow-hidden bg-slate-950', densePanel ? 'p-2' : 'p-3')}>
            <div className="flex h-full min-h-0 flex-col">
              {inspectBanner}
              <div className="min-h-0 flex-1 overflow-hidden">
                {modules.map((m) => (
                  <TabsContent key={m.id} value={m.id} className="vacp-debug-ui-scroll h-full min-h-0 overflow-auto">
                    {renderModule(m.id)}
                  </TabsContent>
                ))}
              </div>
            </div>
          </div>
        </Tabs>
      </div>
    </div>
    </TooltipProvider>
  );
}
