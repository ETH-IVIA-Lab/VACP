import { Braces, Clock, Database, GitGraph, History, MessageSquare, Radar, Zap } from 'lucide-react';
import type { ReactElement, ReactNode, RefObject } from 'react';

import type { VacpRuntimeSnapshot } from '@vacp/protocol';
import type { VacpInspectorModuleId } from '@vacp/inspector/overlay/inspector-store';
import { IconButton } from '@vacp/inspector/overlay/icon-button';
import type { RuntimeHealthSnapshot } from '@vacp/inspector/overlay/runtime-health';
import type { VacpRuntimeBridge } from '@vacp/protocol';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@vacp/inspector/ui/components/ui/tabs';
import { cn } from '@vacp/inspector/ui/lib/utils';

export type VacpInspectorBridgeStatus = 'missing' | 'unknown' | 'ok';

type InspectorModule = Readonly<{ id: VacpInspectorModuleId; title: string; description: string; icon: ReactElement }>;

const inlineCodeClass =
  'rounded-md border border-white/[0.075] bg-white/[0.035] px-1.5 py-0.5 text-[11px] font-medium text-neutral-100 ';

const MODULES: readonly InspectorModule[] = [
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
    id: 'json',
    title: 'JSON',
    description: 'Raw snapshot and state controls',
    icon: <Braces className="h-4 w-4 shrink-0" />,
  },
];

const modeHelp = (
  <div className="max-w-[320px] text-[12px] leading-5 text-neutral-100/85">
    <div className="font-semibold text-neutral-100/90">Live</div>
    <div>Panels follow the latest provider snapshots (what the app is doing now).</div>
    <div className="mt-2 font-semibold text-neutral-100/90">Inspect (time travel)</div>
    <div>
      Panels show the state at the history cursor. If supported, cursor changes also replay state into the host app.
    </div>
    <div className="mt-2">Use the History module to move the cursor and replay/inspect past snapshots.</div>
    <div className="mt-2">Tip: switch back to Live to resume tracking new snapshots.</div>
  </div>
);

function bridgeDotClass(status: VacpInspectorBridgeStatus): string {
  if (status === 'ok') return 'bg-teal-300 ';

  if (status === 'unknown') return 'bg-neutral-100/42';

  return 'bg-neutral-100/24';
}

function InspectorDock(props: {
  rootRef: RefObject<HTMLDivElement | null>;
  buttonRef: RefObject<HTMLButtonElement | null>;
  bridgeStatus: VacpInspectorBridgeStatus;
  pillTitle: string;
  open: boolean;
  setOpen: (open: boolean) => void;
}): ReactElement {
  const dotClass = bridgeDotClass(props.bridgeStatus);

  return (
    <div
      id="vacp-inspector-root"
      className="vacp-inspector-root fixed z-[2147483000] isolate touch-none"
      ref={props.rootRef}
    >
      <button
        ref={props.buttonRef}
        type="button"
        aria-label={props.pillTitle}
        className={cn(
          'vacp-inspector-button relative grid h-11 w-11 select-none place-items-center rounded-full border border-white/14 bg-[#171717]/95 text-neutral-100 ',
          'cursor-grab transition-colors hover:border-white/24 hover:bg-[#171717]/95  active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/42',
          props.open && 'border-white/24 bg-[#171717]/96 ',
          props.bridgeStatus === 'ok' && 'border-teal-200/22 ',
        )}
        data-bridge={props.bridgeStatus}
        data-state={props.open ? 'open' : 'closed'}
        title={props.pillTitle}
        onClick={() => props.setOpen(!props.open)}
      >
        <Radar className="h-5 w-5 text-neutral-50/88" strokeWidth={1.8} aria-hidden="true" />
        <span className={cn('absolute bottom-1 h-1 w-4 rounded-full', dotClass)} aria-hidden="true" />
      </button>
    </div>
  );
}

function ModeToggle(props: {
  bridge: VacpRuntimeBridge | null;
  runtime: VacpRuntimeSnapshot | null;
}): ReactElement | null {
  if (!props.runtime || !props.bridge) return null;
  const inspect = props.runtime.mode === 'inspect';

  return (
    <IconButton
      icon={
        inspect ? (
          <History className="h-4 w-4 text-neutral-100/90" />
        ) : (
          <Clock className="h-4 w-4 text-neutral-100/90" />
        )
      }
      label="Toggle live/inspect mode"
      title={modeHelp}
      pressed={inspect}
      size="iconSm"
      onClick={() => {
        const next = inspect ? 'live' : 'inspect';
        props.bridge?.setMode?.(next, { source: 'inspector', message: `mode=${next}` });
      }}
    />
  );
}

function PanelTopBar(props: {
  panelHeaderRef: RefObject<HTMLDivElement | null>;
  compactDragRef: RefObject<HTMLDivElement | null>;
  titleId: string;
  meta: string;
  activeModule: InspectorModule;
  compactPanel: boolean;
  showNavLabels: boolean;
  moduleNav: ReactNode;
  bridge: VacpRuntimeBridge | null;
  runtime: VacpRuntimeSnapshot | null;
}): ReactElement {
  return (
    <div
      ref={props.panelHeaderRef}
      data-vacp-inspector-panel-drag="1"
      className={cn(
        'vacp-inspector-topbar',
        'relative flex min-w-0 items-center border-b border-white/[0.075]',
        'bg-[#171717]/96',
        props.compactPanel ? 'min-h-11 gap-1.5 px-1.5 py-1.5' : 'min-h-11 gap-2 px-2.5 py-1.5',
      )}
    >
      <div
        ref={props.compactDragRef}
        data-vacp-inspector-drag-strip="1"
        className={cn(
          'vacp-inspector-drag-strip absolute left-1/2 top-0 z-30 flex h-2.5 w-14 -translate-x-1/2 cursor-grab justify-center pt-1 transition-opacity active:cursor-grabbing',
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
          <div className="vacp-inspector-title flex min-w-0 items-center gap-1.5 text-[12px] font-semibold text-neutral-100/90">
            <span className="shrink-0 text-neutral-100/74" aria-hidden="true">
              {props.activeModule.icon}
            </span>
            <span className="whitespace-nowrap">{props.activeModule.title}</span>
          </div>
          <div className="text-[10px] text-neutral-100/50">{props.activeModule.description}</div>
        </div>
        {props.moduleNav}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1.5">
        {props.meta ? (
          <div className="vacp-inspector-meta sr-only" aria-live="polite">
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
  setModuleId: (id: VacpInspectorModuleId) => void;
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
  modules: readonly InspectorModule[];
  compactPanel: boolean;
  densePanel: boolean;
  showLabels: boolean;
}): ReactElement {
  return (
    <nav
      className={cn(
        'vacp-inspector-nav min-w-0 max-w-full overflow-x-auto p-1',
        '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        props.showLabels && 'flex-1',
        !props.showLabels && 'p-0.5',
      )}
      aria-label="VACP inspector modules"
    >
      <TabsList
        loop
        className={cn('vacp-inspector-nav-list gap-1', props.showLabels ? 'grid w-full grid-cols-6' : 'w-max flex-row')}
      >
        {props.modules.map((m) => (
          <TabsTrigger
            key={m.id}
            value={m.id}
            className={cn(
              'vacp-inspector-module group shrink-0 justify-center rounded-md bg-transparent text-neutral-100/68 transition-colors',
              props.showLabels ? 'h-8 min-w-0 px-1.5 py-0' : 'h-7 w-7 p-0',
            )}
            data-module-id={m.id}
            title={`${m.title}: ${m.description}`}
            aria-label={m.title}
          >
            {m.icon}
            <span
              className={cn('min-w-0 whitespace-nowrap text-[11px] font-semibold', !props.showLabels && 'sr-only')}
              data-vacp-inspector-nav-label={m.id}
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
  modules: readonly InspectorModule[];
  densePanel: boolean;
  inspectBanner: ReactNode;
  renderModule: (id: VacpInspectorModuleId) => ReactElement | null;
}): ReactElement {
  return (
    <div
      className={cn(
        'vacp-inspector-content min-h-0 min-w-0 overflow-hidden bg-[#171717]',
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
              className="vacp-inspector-scroll vacp-inspector-tab-content h-full min-h-0 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/28"
            >
              {props.renderModule(m.id)}
            </TabsContent>
          ))}
        </div>
      </div>
    </div>
  );
}

function healthToneClass(tone: 'ok' | 'warn' | 'error' | 'muted'): string {
  if (tone === 'ok') return 'text-neutral-300';

  if (tone === 'error') return 'border-red-200/18 bg-red-300/[0.07] text-red-50/84';

  if (tone === 'warn') return 'border-amber-100/14 bg-amber-100/[0.055] text-amber-50/76';

  return 'text-neutral-400';
}

function HealthPill(props: { label: string; value: string | number; tone?: 'ok' | 'warn' | 'error' | 'muted' }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 px-1 text-[10px] leading-none',
        healthToneClass(props.tone ?? 'muted'),
      )}
    >
      <span className="font-semibold">{props.label}</span>
      <span>{props.value}</span>
    </span>
  );
}

function RuntimeHealthStrip(props: { health: RuntimeHealthSnapshot; densePanel: boolean }): ReactElement {
  const bridgeTone =
    props.health.bridgeStatus === 'ok' ? 'ok' : props.health.bridgeStatus === 'missing' ? 'error' : 'warn';

  const providerTone =
    props.health.providerStatus === 'ok' ? 'ok' : props.health.providerStatus === 'error' ? 'error' : 'warn';

  const consoleTone = props.health.consoleErrors > 0 ? 'error' : 'ok';
  const runtimeTone = props.health.runtimeErrors > 0 ? 'error' : 'ok';
  const networkTone = props.health.networkFailures > 0 ? 'error' : 'ok';

  return (
    <div
      data-vacp-runtime-health="1"
      className={cn(
        'flex min-w-0 items-center gap-1.5 overflow-x-auto border-b border-white/[0.075] bg-[#171717]/96 px-2 py-1.5',
        '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        props.densePanel && 'py-1',
      )}
      title={props.health.lastIssue ?? 'Runtime health'}
    >
      <HealthPill label="Bridge" value={props.health.bridgeStatus} tone={bridgeTone} />
      <HealthPill label="Provider" value={props.health.providerStatus} tone={providerTone} />
      <HealthPill label="Mode" value={props.health.mode} tone={props.health.mode === 'inspect' ? 'warn' : 'muted'} />
      <HealthPill label="History" value={props.health.historyLength} />
      <HealthPill label="Console" value={props.health.consoleErrors} tone={consoleTone} />
      <HealthPill label="Runtime" value={props.health.runtimeErrors} tone={runtimeTone} />
      <HealthPill label="Network" value={props.health.networkFailures} tone={networkTone} />
      {props.health.lastIssue ? (
        <span className="min-w-[180px] truncate text-[10px] text-neutral-100/52">{props.health.lastIssue}</span>
      ) : null}
    </div>
  );
}

function ModuleShell(props: {
  panelHeaderRef: RefObject<HTMLDivElement | null>;
  compactDragRef: RefObject<HTMLDivElement | null>;
  titleId: string;
  meta: string;
  moduleId: VacpInspectorModuleId;
  setModuleId: (id: VacpInspectorModuleId) => void;
  compactPanel: boolean;
  densePanel: boolean;
  bridge: VacpRuntimeBridge | null;
  runtime: VacpRuntimeSnapshot | null;
  runtimeHealth: RuntimeHealthSnapshot;
  inspectBanner: ReactNode;
  renderModule: (id: VacpInspectorModuleId) => ReactElement | null;
}): ReactElement {
  const activeModule = MODULES.find((module) => module.id === props.moduleId) ?? MODULES[0]!;
  const showNavLabels = !props.compactPanel && !props.densePanel;

  return (
    <Tabs
      value={props.moduleId}
      onValueChange={(v) => props.setModuleId(v as VacpInspectorModuleId)}
      orientation="horizontal"
      activationMode="manual"
      className="grid min-h-0 w-full min-w-0 max-w-full grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden"
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
      <RuntimeHealthStrip health={props.runtimeHealth} densePanel={props.densePanel} />
      <ModuleContent
        modules={MODULES}
        densePanel={props.densePanel}
        inspectBanner={props.inspectBanner}
        renderModule={props.renderModule}
      />
    </Tabs>
  );
}

export function InspectorView(props: {
  rootRef: RefObject<HTMLDivElement | null>;
  buttonRef: RefObject<HTMLButtonElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  panelHeaderRef: RefObject<HTMLDivElement | null>;
  compactDragRef: RefObject<HTMLDivElement | null>;
  titleId: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  moduleId: VacpInspectorModuleId;
  setModuleId: (id: VacpInspectorModuleId) => void;
  compactPanel: boolean;
  densePanel: boolean;
  bridgeStatus: VacpInspectorBridgeStatus;
  pillTitle: string;
  meta: string;
  bridge: VacpRuntimeBridge | null;
  runtime: VacpRuntimeSnapshot | null;
  runtimeHealth: RuntimeHealthSnapshot;
  renderModule: (id: VacpInspectorModuleId) => ReactElement | null;
}): ReactElement {
  const panelState = props.open ? 'open' : 'closed';

  return (
    <div data-vacp-inspector="1">
      <InspectorDock
        rootRef={props.rootRef}
        buttonRef={props.buttonRef}
        bridgeStatus={props.bridgeStatus}
        pillTitle={props.pillTitle}
        open={props.open}
        setOpen={props.setOpen}
      />
      <div
        id="vacp-inspector-panel"
        className={cn(
          'vacp-inspector-panel fixed z-[2147483001] h-[min(620px,calc(100vh-92px))] w-[min(900px,calc(100vw-28px))] overflow-hidden rounded-lg border border-white/[0.105] bg-[#171717] text-neutral-100 ',
          props.open ? 'grid' : 'hidden',
          props.densePanel && 'vacp-inspector-dense',
        )}
        ref={props.panelRef}
        hidden={!props.open}
        data-state={panelState}
        data-vacp-inspector="1"
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
          runtimeHealth={props.runtimeHealth}
          inspectBanner={<InspectBanner runtime={props.runtime} setModuleId={props.setModuleId} />}
          renderModule={props.renderModule}
        />
      </div>
    </div>
  );
}
