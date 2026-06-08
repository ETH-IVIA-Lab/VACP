import { Braces, Clock, Database, GitGraph, History, MessageSquare, Radar, Settings2, Zap } from 'lucide-react';
import type { ReactElement, ReactNode, RefObject } from 'react';

import type { VacpRuntimeSnapshot } from '@vacp/core';
import type { VacpDebugModuleId } from '@vacp/debug-ui/overlay/debug-store';
import { IconButton } from '@vacp/debug-ui/overlay/icon-button';
import type { VacpWindowBridge } from '@vacp/debug-ui/types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@vacp/debug-ui/ui/components/ui/tabs';
import { cn } from '@vacp/debug-ui/ui/lib/utils';

export type VacpDebugBridgeStatus = 'missing' | 'unknown' | 'ok';

type DebugModule = Readonly<{ id: VacpDebugModuleId; title: string; description: string; icon: ReactElement }>;

const inlineCodeClass =
  'rounded-md border border-white/[0.075] bg-white/[0.035] px-1.5 py-0.5 text-[11px] font-medium text-slate-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.018)]';

const MODULES: readonly DebugModule[] = [
  {
    id: 'graph',
    title: 'Graph',
    description: 'Capability graph and node inspector',
    icon: <GitGraph className="h-4 w-4 shrink-0" />,
  },
  {
    id: 'data',
    title: 'Data',
    description: 'Data handles, SQL, and result payloads',
    icon: <Database className="h-4 w-4 shrink-0" />,
  },
  {
    id: 'actions',
    title: 'Actions',
    description: 'Semantic actions and explicit params',
    icon: <Zap className="h-4 w-4 shrink-0" />,
  },
  {
    id: 'history',
    title: 'History',
    description: 'Runtime events and inspect cursor',
    icon: <History className="h-4 w-4 shrink-0" />,
  },
  {
    id: 'chat',
    title: 'Chat',
    description: 'Agent chat, tool traces, and sessions',
    icon: <MessageSquare className="h-4 w-4 shrink-0" />,
  },
  {
    id: 'settings',
    title: 'Settings',
    description: 'Debug UI flags and install behavior',
    icon: <Settings2 className="h-4 w-4 shrink-0" />,
  },
  {
    id: 'json',
    title: 'JSON',
    description: 'Raw snapshot and state controls',
    icon: <Braces className="h-4 w-4 shrink-0" />,
  },
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
  if (status === 'ok') return 'bg-teal-300 shadow-[0_0_0_3px_rgba(45,212,191,0.16),0_0_14px_rgba(45,212,191,0.34)]';
  if (status === 'unknown') return 'bg-slate-100/42';
  return 'bg-slate-100/24';
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
          'vacp-debug-ui-button relative grid h-11 w-11 select-none place-items-center rounded-full border border-white/14 bg-[#11171b]/95 text-slate-100 shadow-[0_12px_34px_rgba(0,0,0,0.28)]',
          'cursor-grab transition-[background-color,border-color,box-shadow,transform] hover:border-white/24 hover:bg-[#151d22]/95 active:scale-[0.97] active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/42',
          props.open &&
            'border-white/24 bg-[#151d22]/96 shadow-[0_15px_36px_rgba(0,0,0,0.3),0_0_0_1px_rgba(255,255,255,0.06)]',
          props.bridgeStatus === 'ok' &&
            'border-teal-200/22 shadow-[0_12px_34px_rgba(0,0,0,0.28),0_0_0_1px_rgba(45,212,191,0.08)]',
        )}
        data-bridge={props.bridgeStatus}
        data-state={props.open ? 'open' : 'closed'}
        title={props.pillTitle}
        onClick={() => props.setOpen(!props.open)}
      >
        <Radar className="h-5 w-5 text-slate-50/88" strokeWidth={1.8} aria-hidden="true" />
        <span className={cn('absolute bottom-1 h-1 w-4 rounded-full', dotClass)} aria-hidden="true" />
      </button>
    </div>
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

function PanelTopBar(props: {
  panelHeaderRef: RefObject<HTMLDivElement | null>;
  compactDragRef: RefObject<HTMLDivElement | null>;
  titleId: string;
  meta: string;
  activeModule: DebugModule;
  compactPanel: boolean;
  showNavLabels: boolean;
  moduleNav: ReactNode;
  bridge: VacpWindowBridge | null;
  runtime: VacpRuntimeSnapshot | null;
}): ReactElement {
  return (
    <div
      ref={props.panelHeaderRef}
      data-vacp-debug-panel-drag="1"
      className={cn(
        'vacp-debug-ui-topbar',
        'relative flex min-w-0 items-center border-b border-white/[0.075]',
        'bg-[#0f161a]/96',
        props.compactPanel ? 'min-h-11 gap-1.5 px-1.5 py-1.5' : 'min-h-11 gap-2 px-2.5 py-1.5',
      )}
    >
      <div
        ref={props.compactDragRef}
        data-vacp-debug-drag-strip="1"
        className={cn(
          'vacp-debug-ui-drag-strip absolute left-1/2 top-0 z-30 flex h-2.5 w-14 -translate-x-1/2 cursor-grab justify-center pt-1 transition-opacity active:cursor-grabbing',
          props.compactPanel ? 'opacity-80' : 'pointer-events-none opacity-0',
        )}
        aria-hidden="true"
      >
        <span className="h-1 w-10 rounded-full bg-white/12" />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div
          id={props.titleId}
          className={cn(
            'min-w-0',
            props.compactPanel || props.showNavLabels ? 'sr-only' : 'hidden w-[188px] shrink-0 sm:block',
          )}
        >
          <div className="vacp-debug-ui-title flex min-w-0 items-center gap-1.5 text-[12px] font-semibold text-slate-100/90">
            <span className="shrink-0 text-slate-100/74" aria-hidden="true">
              {props.activeModule.icon}
            </span>
            <span className="whitespace-nowrap">{props.activeModule.title}</span>
          </div>
          <div className="text-[10px] text-slate-100/50">{props.activeModule.description}</div>
        </div>
        {props.moduleNav}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1.5">
        {props.meta ? (
          <div className="vacp-debug-ui-meta sr-only" aria-live="polite">
            {props.meta}
          </div>
        ) : null}
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
          {at ? ` / ${at}` : ''}
          {msg ? ` / ${msg}` : ''}
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
  showLabels: boolean;
}): ReactElement {
  return (
    <nav
      className={cn(
        'vacp-debug-ui-nav min-w-0 max-w-full overflow-x-auto rounded-lg border border-white/[0.075] bg-white/[0.025] p-1',
        '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        props.showLabels && 'flex-1',
        !props.showLabels && 'p-0.5',
      )}
      aria-label="VACP debug modules"
    >
      <TabsList
        loop
        className={cn('vacp-debug-ui-nav-list gap-1', props.showLabels ? 'grid w-full grid-cols-7' : 'w-max flex-row')}
      >
        {props.modules.map((m) => (
          <TabsTrigger
            key={m.id}
            value={m.id}
            className={cn(
              'vacp-debug-ui-module group shrink-0 justify-center rounded-md bg-transparent text-slate-100/68 transition-[background-color,color,transform]',
              props.showLabels ? 'h-8 min-w-0 px-1.5 py-0' : 'h-7 w-7 p-0',
            )}
            data-module-id={m.id}
            title={`${m.title}: ${m.description}`}
            aria-label={m.title}
          >
            {m.icon}
            <span
              className={cn('min-w-0 whitespace-nowrap text-[11px] font-semibold', !props.showLabels && 'sr-only')}
              data-vacp-debug-nav-label={m.id}
            >
              {m.title}
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
        props.densePanel ? 'p-1.5' : 'p-2',
      )}
    >
      <div className="flex h-full min-h-0 flex-col">
        {props.inspectBanner}
        <div className="min-h-0 flex-1 overflow-hidden">
          {props.modules.map((m) => (
            <TabsContent
              key={m.id}
              value={m.id}
              className="vacp-debug-ui-scroll vacp-debug-ui-tab-content h-full min-h-0 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/28"
            >
              {props.renderModule(m.id)}
            </TabsContent>
          ))}
        </div>
      </div>
    </div>
  );
}

function ModuleShell(props: {
  panelHeaderRef: RefObject<HTMLDivElement | null>;
  compactDragRef: RefObject<HTMLDivElement | null>;
  titleId: string;
  meta: string;
  moduleId: VacpDebugModuleId;
  setModuleId: (id: VacpDebugModuleId) => void;
  compactPanel: boolean;
  densePanel: boolean;
  bridge: VacpWindowBridge | null;
  runtime: VacpRuntimeSnapshot | null;
  inspectBanner: ReactNode;
  renderModule: (id: VacpDebugModuleId) => ReactElement | null;
}): ReactElement {
  const activeModule = MODULES.find((module) => module.id === props.moduleId) ?? MODULES[0]!;
  const showNavLabels = !props.compactPanel && !props.densePanel;
  return (
    <Tabs
      value={props.moduleId}
      onValueChange={(v) => props.setModuleId(v as VacpDebugModuleId)}
      orientation="horizontal"
      activationMode="manual"
      className="grid min-h-0 w-full min-w-0 max-w-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden"
    >
      <PanelTopBar
        panelHeaderRef={props.panelHeaderRef}
        compactDragRef={props.compactDragRef}
        titleId={props.titleId}
        meta={props.meta}
        activeModule={activeModule}
        compactPanel={props.compactPanel}
        showNavLabels={showNavLabels}
        moduleNav={
          <ModuleNav
            modules={MODULES}
            compactPanel={props.compactPanel}
            densePanel={props.densePanel}
            showLabels={showNavLabels}
          />
        }
        bridge={props.bridge}
        runtime={props.runtime}
      />
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
  panelRef: RefObject<HTMLDivElement | null>;
  panelHeaderRef: RefObject<HTMLDivElement | null>;
  compactDragRef: RefObject<HTMLDivElement | null>;
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
  meta: string;
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
        id="vacp-debug-ui-panel"
        className={cn(
          'vacp-debug-ui-panel fixed z-[2147483001] h-[min(620px,calc(100vh-92px))] w-[min(900px,calc(100vw-28px))] overflow-hidden rounded-lg border border-white/[0.105] bg-[#0b1115] text-slate-100 shadow-[0_18px_44px_rgba(0,0,0,0.34)]',
          props.panelVisible ? 'grid' : 'hidden',
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
        <ModuleShell
          panelHeaderRef={props.panelHeaderRef}
          compactDragRef={props.compactDragRef}
          titleId={props.titleId}
          meta={props.meta}
          moduleId={props.moduleId}
          setModuleId={props.setModuleId}
          compactPanel={props.compactPanel}
          densePanel={props.densePanel}
          bridge={props.bridge}
          runtime={props.runtime}
          inspectBanner={<InspectBanner runtime={props.runtime} setModuleId={props.setModuleId} />}
          renderModule={props.renderModule}
        />
      </div>
    </div>
  );
}
