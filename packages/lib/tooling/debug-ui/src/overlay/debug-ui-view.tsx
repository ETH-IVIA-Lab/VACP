import {
  Braces,
  Clock,
  Database,
  GitGraph,
  History,
  ListOrdered,
  MessageSquare,
  Minus,
  Plus,
  X,
  Zap,
} from 'lucide-react';
import type { ReactElement, ReactNode, RefObject } from 'react';
import { useMemo } from 'react';

import type { VacpRuntimeSnapshot } from '@vacp/core';
import type { VacpWindowBridge } from '@vacp/debug-ui/types';
import type { VacpDebugModuleId } from '@vacp/debug-ui/overlay/debug-store';
import { IconButton } from '@vacp/debug-ui/overlay/icon-button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@vacp/debug-ui/ui/components/ui/tabs';
import { cn } from '@vacp/debug-ui/ui/lib/utils';

export type VacpDebugBridgeStatus = 'missing' | 'unknown' | 'ok';

const inlineCodeClass =
  'rounded-md border border-white/10 bg-slate-900/70 px-1.5 py-0.5 text-[11px] font-medium text-slate-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)]';

export function DebugUiView(props: {
  rootRef: RefObject<HTMLDivElement | null>;
  buttonRef: RefObject<HTMLButtonElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  panelHeaderRef: RefObject<HTMLDivElement | null>;
  titleId: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  moduleId: VacpDebugModuleId;
  setModuleId: (id: VacpDebugModuleId) => void;
  compactPanel: boolean;
  densePanel: boolean;
  bridgeStatus: VacpDebugBridgeStatus;
  pillTitle: string;
  title: string;
  meta: string;
  maximized: boolean;
  minimize: () => void;
  toggleMaximize: () => void;
  bridge: VacpWindowBridge | null;
  runtime: VacpRuntimeSnapshot | null;
  renderModule: (id: VacpDebugModuleId) => ReactElement | null;
}): ReactElement {
  const dotClass =
    props.bridgeStatus === 'ok' ? 'bg-emerald-300' : props.bridgeStatus === 'unknown' ? 'bg-amber-300' : 'bg-white/40';

  const modules: { id: VacpDebugModuleId; title: string; icon: ReactElement }[] = useMemo(
    () => [
      { id: 'graph', title: 'Graph', icon: <GitGraph className="h-4 w-4 text-slate-100/85" /> },
      { id: 'data', title: 'Data', icon: <Database className="h-4 w-4 text-slate-100/85" /> },
      { id: 'actions', title: 'Actions', icon: <Zap className="h-4 w-4 text-slate-100/85" /> },
      { id: 'history', title: 'History', icon: <History className="h-4 w-4 text-slate-100/85" /> },
      { id: 'playbook', title: 'Playbook', icon: <ListOrdered className="h-4 w-4 text-slate-100/85" /> },
      { id: 'chat', title: 'Chat', icon: <MessageSquare className="h-4 w-4 text-slate-100/85" /> },
      { id: 'json', title: 'JSON', icon: <Braces className="h-4 w-4 text-slate-100/85" /> },
    ],
    [],
  );

  const modeHelp = (
    <div className="max-w-[320px] text-[12px] leading-5 text-slate-100/85">
      <div className="font-semibold text-slate-100/90">Live</div>
      <div>Panels follow the latest provider snapshots (what the app is doing now).</div>
      <div className="mt-2 font-semibold text-slate-100/90">Inspect (time travel)</div>
      <div>
        Panels show the state at the history cursor. If supported, cursor changes also replay state into the host app.
      </div>
      <div className="mt-2">Use the History module to move the cursor and replay/inspect past snapshots.</div>
      <div className="mt-2">Tip: switch back to Live to resume tracking new snapshots.</div>
    </div>
  );

  const modeToggle: ReactElement | null = useMemo(() => {
    const rt = props.runtime;
    const bridge = props.bridge;
    if (!rt || !bridge) return null;
    const inspect = rt.mode === 'inspect';
    return (
      <IconButton
        icon={
          inspect ? <History className="h-4 w-4 text-slate-100/90" /> : <Clock className="h-4 w-4 text-slate-100/90" />
        }
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
  }, [modeHelp, props.bridge, props.runtime]);

  const inspectBanner: ReactNode = useMemo(() => {
    const rt = props.runtime;
    if (!rt || rt.mode !== 'inspect') return null;
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
            onClick={() => props.setModuleId('history')}
          >
            Open history
          </button>
        </div>
        <div className="mt-1 text-amber-50/70">
          Panels show the state at the cursor. If supported, moving the cursor also replays that state into the host app
          (via <code className={inlineCodeClass}>vacp.apply_state</code>).
        </div>
      </div>
    );
  }, [props.runtime, props.setModuleId]);

  return (
    <div data-vacp-debug-ui="1">
      <div
        id="vacp-debug-ui-root"
        className="vacp-debug-ui-root fixed z-[2147483000] isolate touch-none"
        ref={props.rootRef}
      >
        <button
          ref={props.buttonRef}
          type="button"
          className="vacp-debug-ui-button inline-flex select-none items-center gap-2 rounded-full border border-white/20 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-100 shadow-[0_8px_24px_rgba(0,0,0,0.25)] cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
          data-bridge={props.bridgeStatus}
          title={props.pillTitle}
          onClick={() => props.setOpen(!props.open)}
        >
          <span>VACP</span>
          <span className={cn('h-2 w-2 rounded-full ring-2 ring-slate-950', dotClass)} aria-hidden="true" />
        </button>
      </div>

      <div
        id="vacp-debug-ui-panel"
        className={cn(
          'vacp-debug-ui-panel fixed z-[2147483001] grid h-[min(680px,calc(100vh-92px))] w-[min(980px,calc(100vw-28px))] overflow-hidden rounded-xl border border-white/20 bg-slate-950 text-slate-100 shadow-[0_16px_40px_rgba(0,0,0,0.35)]',
          'grid-rows-[auto_minmax(0,1fr)]',
          props.densePanel && 'vacp-debug-ui-dense',
        )}
        ref={props.panelRef}
        style={{ display: props.open ? 'grid' : 'none' }}
        data-vacp-debug-ui="1"
        role="dialog"
        aria-modal="false"
        aria-labelledby={props.titleId}
        tabIndex={-1}
      >
        <div
          ref={props.panelHeaderRef}
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
              onClick={() => props.setOpen(false)}
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
              onClick={() => props.minimize()}
            >
              <Minus
                className="h-3 w-3 text-black/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              aria-label={props.maximized ? 'Restore size' : 'Maximize'}
              title={props.maximized ? 'Restore size' : 'Maximize'}
              className={cn(
                'relative grid h-3.5 w-3.5 place-items-center rounded-full bg-[#28c840]',
                'shadow-[inset_0_0_0_1px_rgba(0,0,0,0.18)]',
                'hover:brightness-[0.98] active:brightness-[0.96]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950',
              )}
              onClick={() => props.toggleMaximize()}
            >
              <Plus
                className="h-3 w-3 text-black/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                aria-hidden="true"
              />
            </button>
          </div>

          <div id={props.titleId} className="min-w-0 flex-1">
            <div className="vacp-debug-ui-title truncate text-xs text-slate-100/85">{props.title}</div>
            {props.meta ? (
              <div className="vacp-debug-ui-meta truncate text-[10px] text-slate-100/55 [font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation_Mono','Courier_New',monospace]">
                {props.meta}
              </div>
            ) : null}
          </div>
          <div className="ml-auto flex items-center gap-2">{modeToggle}</div>
        </div>

        <Tabs
          value={props.moduleId}
          onValueChange={(v) => props.setModuleId(v as VacpDebugModuleId)}
          orientation={props.compactPanel ? 'horizontal' : 'vertical'}
          activationMode="manual"
          className={cn(
            'grid min-h-0',
            props.compactPanel ? 'grid-rows-[auto_minmax(0,1fr)]' : 'grid-cols-[180px_1fr] grid-rows-none',
          )}
        >
          <nav
            className={cn(
              'min-h-0 max-w-full bg-white/5',
              props.densePanel ? 'p-1.5' : 'p-2',
              props.compactPanel
                ? 'overflow-x-auto border-b border-white/10'
                : 'overflow-y-auto border-b-0 border-r border-white/10',
            )}
            aria-label="VACP debug modules"
          >
            <TabsList loop className={cn('vacp-debug-ui-nav-list gap-1', props.compactPanel ? 'flex-row' : 'flex-col')}>
              {modules.map((m) => (
                <TabsTrigger
                  key={m.id}
                  value={m.id}
                  className={cn('vacp-debug-ui-module whitespace-nowrap', props.compactPanel ? 'w-auto' : 'w-full')}
                  title={m.title}
                >
                  {m.icon}
                  <span>{m.title}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </nav>

          <div
            className={cn(
              'vacp-debug-ui-content min-h-0 min-w-0 overflow-hidden bg-slate-950',
              props.densePanel ? 'p-2' : 'p-3',
            )}
          >
            <div className="flex h-full min-h-0 flex-col">
              {inspectBanner}
              <div className="min-h-0 flex-1 overflow-hidden">
                {modules.map((m) => (
                  <TabsContent key={m.id} value={m.id} className="vacp-debug-ui-scroll h-full min-h-0 overflow-auto">
                    {props.renderModule(m.id)}
                  </TabsContent>
                ))}
              </div>
            </div>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
