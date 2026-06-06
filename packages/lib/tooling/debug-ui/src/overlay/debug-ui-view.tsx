import {
  Braces,
  Clock,
  Database,
  GitGraph,
  History,
  MessageSquare,
  Minus,
  Plus,
  Radar,
  Settings2,
  X,
  Zap,
} from 'lucide-react';
import type { ReactElement, ReactNode, RefObject } from 'react';

import type { VacpRuntimeSnapshot } from '@vacp/core';
import type { VacpDebugModuleId } from '@vacp/debug-ui/overlay/debug-store';
import { IconButton } from '@vacp/debug-ui/overlay/icon-button';
import type { VacpWindowBridge } from '@vacp/debug-ui/types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@vacp/debug-ui/ui/components/ui/tabs';
import { cn } from '@vacp/debug-ui/ui/lib/utils';

export type VacpDebugBridgeStatus = 'missing' | 'unknown' | 'ok';

type DebugModule = Readonly<{ id: VacpDebugModuleId; title: string; icon: ReactElement }>;

const inlineCodeClass =
  'rounded-md border border-white/[0.075] bg-white/[0.035] px-1.5 py-0.5 text-[11px] font-medium text-slate-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.018)]';

const MODULES: readonly DebugModule[] = [
  { id: 'graph', title: 'Graph', icon: <GitGraph className="h-4 w-4 shrink-0 text-slate-100/82" /> },
  { id: 'data', title: 'Data', icon: <Database className="h-4 w-4 shrink-0 text-slate-100/82" /> },
  { id: 'actions', title: 'Actions', icon: <Zap className="h-4 w-4 shrink-0 text-slate-100/82" /> },
  { id: 'history', title: 'History', icon: <History className="h-4 w-4 shrink-0 text-slate-100/82" /> },
  { id: 'chat', title: 'Chat', icon: <MessageSquare className="h-4 w-4 shrink-0 text-slate-100/82" /> },
  { id: 'settings', title: 'Settings', icon: <Settings2 className="h-4 w-4 shrink-0 text-slate-100/82" /> },
  { id: 'json', title: 'JSON', icon: <Braces className="h-4 w-4 shrink-0 text-slate-100/82" /> },
];

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

function bridgeDotClass(status: VacpDebugBridgeStatus): string {
  if (status === 'ok') return 'bg-emerald-300';
  if (status === 'unknown') return 'bg-slate-300/58';
  return 'bg-white/40';
}

function DebugDock(props: {
  rootRef: RefObject<HTMLDivElement | null>;
  buttonRef: RefObject<HTMLButtonElement | null>;
  bridgeStatus: VacpDebugBridgeStatus;
  pillTitle: string;
  open: boolean;
  setOpen: (open: boolean) => void;
}): ReactElement {
  const dotClass = bridgeDotClass(props.bridgeStatus);
  return (
    <div
      id="vacp-debug-ui-root"
      className="vacp-debug-ui-root fixed z-[2147483000] isolate touch-none"
      ref={props.rootRef}
    >
      <button
        ref={props.buttonRef}
        type="button"
        aria-label={props.pillTitle}
        className={cn(
          'vacp-debug-ui-button relative grid h-11 w-11 select-none place-items-center rounded-full border border-white/15 bg-[#11171b]/95 text-slate-100 shadow-[0_12px_34px_rgba(0,0,0,0.28)]',
          'cursor-grab transition-[background-color,border-color,box-shadow,transform] hover:border-white/25 hover:bg-[#151d22]/95 active:scale-[0.96] active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/55',
          props.open &&
            'border-emerald-300/35 bg-[#13201d]/95 shadow-[0_15px_36px_rgba(16,185,129,0.18),0_0_0_1px_rgba(110,231,183,0.1)]',
        )}
        data-bridge={props.bridgeStatus}
        data-state={props.open ? 'open' : 'closed'}
        title={props.pillTitle}
        onClick={() => props.setOpen(!props.open)}
      >
        <Radar className="h-5 w-5 text-slate-50/88" strokeWidth={1.8} aria-hidden="true" />
        <span
          className={cn('absolute right-1 top-1 h-2.5 w-2.5 rounded-full ring-2 ring-[#11171b]', dotClass)}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}

function WindowControls(props: {
  maximized: boolean;
  setOpen: (open: boolean) => void;
  minimize: () => void;
  toggleMaximize: () => void;
}): ReactElement {
  return (
    <div className="group flex items-center gap-2">
      <TrafficButton label="Close" color="bg-slate-400/46 hover:bg-red-300/58" onClick={() => props.setOpen(false)}>
        <X
          className="h-2.5 w-2.5 text-black/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          aria-hidden="true"
        />
      </TrafficButton>
      <TrafficButton
        label="Minimize"
        title="Restore to the default panel size."
        color="bg-slate-400/46 hover:bg-slate-300/62"
        onClick={props.minimize}
      >
        <Minus
          className="h-3 w-3 text-black/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          aria-hidden="true"
        />
      </TrafficButton>
      <TrafficButton
        label={props.maximized ? 'Restore size' : 'Maximize'}
        color="bg-slate-400/46 hover:bg-emerald-300/58"
        onClick={props.toggleMaximize}
      >
        <Plus
          className="h-3 w-3 text-black/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
          aria-hidden="true"
        />
      </TrafficButton>
    </div>
  );
}

function TrafficButton(props: {
  label: string;
  title?: string;
  color: string;
  onClick: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.title ?? props.label}
      className={cn(
        'relative grid h-3.5 w-3.5 place-items-center rounded-full',
        'shadow-[inset_0_0_0_1px_rgba(0,0,0,0.18)]',
        'hover:brightness-[0.98] active:brightness-[0.96]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950',
        props.color,
      )}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

function ModeToggle(props: {
  bridge: VacpWindowBridge | null;
  runtime: VacpRuntimeSnapshot | null;
}): ReactElement | null {
  if (!props.runtime || !props.bridge) return null;
  const inspect = props.runtime.mode === 'inspect';
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
        props.bridge?.setMode?.(next, { source: 'debug', message: `mode=${next}` });
      }}
    />
  );
}

function BridgeBadge(props: { status: VacpDebugBridgeStatus }): ReactElement {
  return (
    <span
      className={cn(
        'hidden min-h-6 items-center gap-1.5 rounded-full border px-2 text-[10px] font-semibold sm:inline-flex',
        props.status === 'ok'
          ? 'border-emerald-200/22 bg-emerald-300/9 text-emerald-50/88'
          : props.status === 'unknown'
            ? 'border-white/[0.08] bg-white/[0.035] text-slate-100/64'
            : 'border-white/[0.08] bg-white/[0.035] text-slate-100/56',
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', bridgeDotClass(props.status))} aria-hidden="true" />
      {props.status === 'ok' ? 'Bridge' : props.status === 'unknown' ? 'Checking' : 'No bridge'}
    </span>
  );
}

function PanelTopBar(props: {
  panelHeaderRef: RefObject<HTMLDivElement | null>;
  titleId: string;
  title: string;
  meta: string;
  bridgeStatus: VacpDebugBridgeStatus;
  maximized: boolean;
  setOpen: (open: boolean) => void;
  minimize: () => void;
  toggleMaximize: () => void;
  bridge: VacpWindowBridge | null;
  runtime: VacpRuntimeSnapshot | null;
}): ReactElement {
  return (
    <div
      ref={props.panelHeaderRef}
      className={cn(
        'vacp-debug-ui-topbar',
        'flex h-12 items-center gap-3 border-b border-white/[0.075]',
        'bg-[#0f161a]/96',
        'px-3 py-2',
      )}
    >
      <WindowControls
        maximized={props.maximized}
        setOpen={props.setOpen}
        minimize={props.minimize}
        toggleMaximize={props.toggleMaximize}
      />
      <div id={props.titleId} className="min-w-0 flex-1">
        <div className="vacp-debug-ui-title truncate text-[12px] font-semibold text-slate-100/90">{props.title}</div>
        {props.meta ? (
          <div className="vacp-debug-ui-meta truncate text-[10px] text-slate-100/54 [font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation_Mono','Courier_New',monospace]">
            {props.meta}
          </div>
        ) : null}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <BridgeBadge status={props.bridgeStatus} />
        <ModeToggle bridge={props.bridge} runtime={props.runtime} />
      </div>
    </div>
  );
}

function InspectBanner(props: {
  runtime: VacpRuntimeSnapshot | null;
  setModuleId: (id: VacpDebugModuleId) => void;
}): ReactElement | null {
  const rt = props.runtime;
  if (!rt || rt.mode !== 'inspect') return null;
  const cursor = Number.isFinite(rt.cursor) ? rt.cursor : -1;
  const entry = cursor >= 0 && cursor < rt.history.length ? rt.history[cursor] : null;
  const at = entry?.at ? new Date(entry.at).toLocaleTimeString() : '';
  const msg = entry?.message ?? null;
  return (
    <div className="mb-3 rounded-lg border border-amber-100/16 bg-amber-100/[0.055] px-3 py-2 text-[12px] text-amber-50/76">
      <div className="flex flex-wrap items-center gap-2">
        <div className="font-semibold text-amber-50/82">Inspect mode (time travel)</div>
        <div className="text-amber-50/66">
          cursor {cursor} / {Math.max(0, rt.history.length - 1)}
          {at ? ` • ${at}` : ''}
          {msg ? ` • ${msg}` : ''}
        </div>
        <div className="flex-1" />
        <button
          type="button"
          className="rounded-md border border-amber-100/16 bg-amber-100/[0.055] px-2 py-1 text-[11px] font-semibold text-amber-50/76 hover:bg-amber-100/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-100/32"
          onClick={() => props.setModuleId('history')}
        >
          Open history
        </button>
      </div>
      <div className="mt-1 text-amber-50/64">
        Panels show the state at the cursor. If supported, moving the cursor also replays that state into the host app
        (via <code className={inlineCodeClass}>vacp.apply_state</code>).
      </div>
    </div>
  );
}

function ModuleNav(props: {
  modules: readonly DebugModule[];
  compactPanel: boolean;
  densePanel: boolean;
}): ReactElement {
  return (
    <nav
      className={cn(
        'vacp-debug-ui-nav min-h-0 min-w-0 max-w-full bg-[#0e1519]/72',
        props.densePanel ? 'p-1.5' : 'p-2',
        props.compactPanel
          ? 'overflow-x-auto border-b border-white/[0.075]'
          : 'overflow-y-auto border-b-0 border-r border-white/[0.075]',
      )}
      aria-label="VACP debug modules"
    >
      <TabsList loop className={cn('vacp-debug-ui-nav-list gap-1', props.compactPanel ? 'w-max flex-row' : 'flex-col')}>
        {props.modules.map((m, index) => (
          <TabsTrigger
            key={m.id}
            value={m.id}
            className={cn(
              'vacp-debug-ui-module group min-h-9 whitespace-nowrap rounded-md bg-transparent transition-[background-color,color,transform]',
              props.compactPanel ? 'w-auto pl-7 pr-2.5' : 'w-full justify-start pl-7 pr-2.5',
            )}
            data-module-id={m.id}
            title={m.title}
          >
            {m.icon}
            <span className="truncate">{m.title}</span>
            <span className="ml-auto hidden rounded border border-white/[0.06] bg-white/[0.025] px-1.5 py-0.5 text-[9px] font-semibold text-slate-100/28 group-hover:text-slate-100/48 group-data-[state=active]:text-slate-100/50 lg:inline">
              Alt {index + 1}
            </span>
          </TabsTrigger>
        ))}
      </TabsList>
    </nav>
  );
}

function ModuleContent(props: {
  modules: readonly DebugModule[];
  densePanel: boolean;
  inspectBanner: ReactNode;
  renderModule: (id: VacpDebugModuleId) => ReactElement | null;
}): ReactElement {
  return (
    <div
      className={cn(
        'vacp-debug-ui-content min-h-0 min-w-0 overflow-hidden bg-[#0b1115]',
        props.densePanel ? 'p-2' : 'p-3',
      )}
    >
      <div className="flex h-full min-h-0 flex-col">
        {props.inspectBanner}
        <div className="min-h-0 flex-1 overflow-hidden">
          {props.modules.map((m) => (
            <TabsContent
              key={m.id}
              value={m.id}
              className="vacp-debug-ui-scroll vacp-debug-ui-tab-content h-full min-h-0 overflow-auto"
            >
              {props.renderModule(m.id)}
            </TabsContent>
          ))}
        </div>
      </div>
    </div>
  );
}

function ModuleTabs(props: {
  moduleId: VacpDebugModuleId;
  setModuleId: (id: VacpDebugModuleId) => void;
  compactPanel: boolean;
  densePanel: boolean;
  inspectBanner: ReactNode;
  renderModule: (id: VacpDebugModuleId) => ReactElement | null;
}): ReactElement {
  return (
    <Tabs
      value={props.moduleId}
      onValueChange={(v) => props.setModuleId(v as VacpDebugModuleId)}
      orientation={props.compactPanel ? 'horizontal' : 'vertical'}
      activationMode="manual"
      className={cn(
        'grid min-h-0 w-full min-w-0 max-w-full overflow-hidden',
        props.compactPanel ? 'grid-rows-[auto_minmax(0,1fr)]' : 'grid-cols-[180px_1fr] grid-rows-none',
      )}
    >
      <ModuleNav modules={MODULES} compactPanel={props.compactPanel} densePanel={props.densePanel} />
      <ModuleContent
        modules={MODULES}
        densePanel={props.densePanel}
        inspectBanner={props.inspectBanner}
        renderModule={props.renderModule}
      />
    </Tabs>
  );
}

export function DebugUiView(props: {
  rootRef: RefObject<HTMLDivElement | null>;
  buttonRef: RefObject<HTMLButtonElement | null>;
  connectorRef: RefObject<HTMLDivElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  panelHeaderRef: RefObject<HTMLDivElement | null>;
  titleId: string;
  open: boolean;
  panelVisible: boolean;
  panelClosing: boolean;
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
  const panelState = props.open ? 'open' : props.panelClosing ? 'closing' : 'closed';

  return (
    <div data-vacp-debug-ui="1">
      <DebugDock
        rootRef={props.rootRef}
        buttonRef={props.buttonRef}
        bridgeStatus={props.bridgeStatus}
        pillTitle={props.pillTitle}
        open={props.open}
        setOpen={props.setOpen}
      />
      <div
        ref={props.connectorRef}
        className={cn(
          'vacp-debug-ui-connector pointer-events-none fixed z-[2147483002]',
          props.panelVisible ? 'block' : 'hidden',
        )}
        data-state={panelState}
        data-vacp-debug-ui="1"
        aria-hidden="true"
      />
      <div
        id="vacp-debug-ui-panel"
        className={cn(
          'vacp-debug-ui-panel fixed z-[2147483001] h-[min(700px,calc(100vh-92px))] w-[min(1020px,calc(100vw-28px))] overflow-hidden rounded-xl border border-white/[0.105] bg-[#0b1115] text-slate-100 shadow-[0_24px_48px_rgba(0,0,0,0.36)]',
          props.panelVisible ? 'grid' : 'hidden',
          'grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)]',
          props.densePanel && 'vacp-debug-ui-dense',
        )}
        ref={props.panelRef}
        hidden={!props.panelVisible}
        data-state={panelState}
        data-vacp-debug-ui="1"
        role="dialog"
        aria-modal="false"
        aria-labelledby={props.titleId}
        tabIndex={-1}
      >
        <PanelTopBar
          panelHeaderRef={props.panelHeaderRef}
          titleId={props.titleId}
          title={props.title}
          meta={props.meta}
          bridgeStatus={props.bridgeStatus}
          maximized={props.maximized}
          setOpen={props.setOpen}
          minimize={props.minimize}
          toggleMaximize={props.toggleMaximize}
          bridge={props.bridge}
          runtime={props.runtime}
        />
        <ModuleTabs
          moduleId={props.moduleId}
          setModuleId={props.setModuleId}
          compactPanel={props.compactPanel}
          densePanel={props.densePanel}
          inspectBanner={<InspectBanner runtime={props.runtime} setModuleId={props.setModuleId} />}
          renderModule={props.renderModule}
        />
      </div>
    </div>
  );
}
