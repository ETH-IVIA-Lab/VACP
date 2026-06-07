import { CheckCircle2, Lock, RefreshCcw, RotateCcw, SlidersHorizontal, Trash2, XCircle } from 'lucide-react';
import type { ReactElement } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';

import {
  clearVacpHyperParamStorageOverride,
  getVacpHyperParamResolution,
  setVacpHyperParamStorageOverride,
  type VacpHyperParamDetail,
  type VacpHyperParamKey,
  type VacpHyperParamSource,
} from '@vacp/core';
import { DEBUG_UI_PANEL_BREAKPOINTS, isDenseDebugPanel } from '@vacp/debug-ui/overlay/debug-ui-breakpoints';
import { useElementSize } from '@vacp/debug-ui/overlay/hooks/use-element-size';
import { Button } from '@vacp/debug-ui/ui/components/ui/button';
import { cn } from '@vacp/debug-ui/ui/lib/utils';

import { ModuleHeader, ModuleRoot } from './module-layout';

type FlagCopy = Readonly<{
  label: string;
  effect: string;
  onText: string;
  offText: string;
}>;

const FLAG_ORDER = [
  'debugUi',
  'exposeBridge',
  'domSnapshot',
  'enableSql',
] as const satisfies readonly VacpHyperParamKey[];

const FLAG_COPY: Record<VacpHyperParamKey, FlagCopy> = {
  debugUi: {
    label: 'Debug overlay',
    effect: 'Installs the in-page VACP overlay when the app calls installVacpDebugUI.',
    onText: 'The floating VACP control appears by default.',
    offText: 'The overlay stays unmounted after reload unless a higher-priority source enables it.',
  },
  exposeBridge: {
    label: 'Bridge exposure',
    effect: 'Publishes the runtime bridge on window.__vacp for browser tools and MCP clients.',
    onText: 'Browser agents can inspect the live VACP bridge.',
    offText: 'The bridge is not exposed on window.',
  },
  domSnapshot: {
    label: 'DOM snapshot',
    effect: 'Injects the VACP JSON DOM snapshot script used by inspection tools.',
    onText: 'Snapshots are available to browser-side inspection.',
    offText: 'DOM snapshot injection is skipped.',
  },
  enableSql: {
    label: 'Raw SQL action',
    effect: 'Registers the raw SQL DataHandle action for providers that support tabular data.',
    onText: 'The Data module can run SQL against eligible handles.',
    offText: 'Raw SQL actions are not registered after reload.',
  },
};

const SOURCE_LABELS: Record<VacpHyperParamSource, string> = {
  url: 'URL',
  env: 'Environment',
  localStorage: 'Browser',
  default: 'Default',
};

function SourceBadge(props: { source: VacpHyperParamSource }): ReactElement {
  const locked = props.source === 'url' || props.source === 'env';
  return (
    <span
      className={cn(
        'inline-flex min-h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-semibold',
        locked
          ? 'border-amber-100/16 bg-amber-100/[0.055] text-amber-50/72'
          : 'border-white/[0.075] bg-white/[0.035] text-slate-100/62',
      )}
    >
      {locked ? <Lock className="h-3 w-3" aria-hidden="true" /> : null}
      {SOURCE_LABELS[props.source]}
    </span>
  );
}

function FlagSwitch(props: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled}
      className={cn(
        'vacp-debug-ui-switch relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-[background-color,border-color,box-shadow,opacity]',
        props.checked
          ? 'border-teal-200/26 bg-teal-300/[0.16] shadow-[inset_0_1px_0_rgba(255,255,255,0.045),0_0_16px_rgba(45,212,191,0.08)]'
          : 'border-white/[0.075] bg-[#101821]/76',
        props.disabled ? 'cursor-not-allowed opacity-42' : 'cursor-pointer hover:border-teal-100/24',
      )}
      onClick={() => props.onChange(!props.checked)}
    >
      <span
        className={cn(
          'inline-flex h-5 w-5 items-center justify-center rounded-full shadow-sm transition-[background-color,color,transform]',
          props.checked ? 'bg-teal-50 text-teal-950/78' : 'bg-slate-200/88 text-slate-950/70',
          props.checked ? 'translate-x-[22px]' : 'translate-x-1',
        )}
      >
        {props.checked ? (
          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        ) : (
          <XCircle className="h-3 w-3" aria-hidden="true" />
        )}
      </span>
    </button>
  );
}

function FlagRow(props: {
  id: VacpHyperParamKey;
  detail: VacpHyperParamDetail;
  compact: boolean;
  onSet: (key: VacpHyperParamKey, value: boolean) => void;
  onClear: (key: VacpHyperParamKey) => void;
}): ReactElement {
  const copy = FLAG_COPY[props.id];
  const locked = props.detail.source === 'url' || props.detail.source === 'env';
  const sourceText =
    props.detail.source === 'url'
      ? `Set by ${props.detail.urlKeys.map((k) => `?${k}`).join(', ')}`
      : props.detail.source === 'env'
        ? `Set by ${props.detail.envKeys.join(', ')}`
        : props.detail.source === 'localStorage'
          ? `Stored in ${props.detail.localStorageKey ?? 'browser storage'}`
          : `Falls back to ${props.detail.default ? 'on' : 'off'}`;
  return (
    <section
      className={cn(
        'vacp-debug-ui-settings-row grid gap-3 border-t border-white/[0.075] py-3.5 first:border-t-0',
        !props.compact && 'sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start',
      )}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="min-w-0 break-words text-[13px] font-semibold text-slate-50">{copy.label}</h3>
          <SourceBadge source={props.detail.source} />
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-semibold',
              props.detail.value ? 'bg-teal-300/[0.10] text-teal-50/84' : 'bg-white/[0.032] text-slate-100/52',
            )}
          >
            {props.detail.value ? 'On' : 'Off'}
          </span>
        </div>
        <p className="mt-1 max-w-[74ch] text-[12px] leading-5 text-slate-100/72">{copy.effect}</p>
        <p className="mt-1 max-w-[74ch] text-[12px] leading-5 text-slate-100/56">
          {props.detail.value ? copy.onText : copy.offText}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-100/48">
          <span>{sourceText}</span>
          {props.detail.raw !== undefined && props.detail.source !== 'default' ? (
            <code className="rounded border border-white/[0.075] bg-[#101821]/70 px-1.5 py-0.5 text-[10px] text-slate-100/66">
              raw={props.detail.raw || '(empty)'}
            </code>
          ) : null}
        </div>
      </div>
      <div
        className={cn(
          'flex shrink-0 items-center gap-2',
          props.compact
            ? 'justify-between rounded-md border border-white/[0.065] bg-white/[0.018] px-2 py-1.5'
            : 'sm:justify-end',
        )}
      >
        {props.compact ? <div className="text-[11px] font-medium text-slate-100/56">Browser override</div> : null}
        <FlagSwitch
          checked={props.detail.value}
          disabled={locked}
          label={`Toggle ${copy.label}`}
          onChange={(checked) => props.onSet(props.id, checked)}
        />
        <Button
          type="button"
          size="iconSm"
          variant="ghost"
          disabled={props.detail.source !== 'localStorage'}
          aria-label={`Clear ${copy.label} browser override`}
          title={`Clear ${copy.label} browser override`}
          onClick={() => props.onClear(props.id)}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      {locked ? (
        <div
          className={cn(
            'rounded-md border border-amber-100/14 bg-amber-100/[0.055] px-3 py-2 text-[11px] leading-5 text-amber-50/68',
            !props.compact && 'sm:col-span-2',
          )}
        >
          Browser changes are disabled while a higher-priority {SOURCE_LABELS[props.detail.source].toLowerCase()} value
          is active.
        </div>
      ) : null}
    </section>
  );
}

export function SettingsModule(): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rootSize = useElementSize(rootRef);
  const compactPanel = rootSize.width < DEBUG_UI_PANEL_BREAKPOINTS.compactControls;
  const densePanel = isDenseDebugPanel(rootSize.width, rootSize.height);
  const boundWide = rootSize.width >= DEBUG_UI_PANEL_BREAKPOINTS.splitPane;
  const [resolution, setResolution] = useState(() => getVacpHyperParamResolution());
  const [needsReload, setNeedsReload] = useState(false);

  const refresh = useCallback(() => setResolution(getVacpHyperParamResolution()), []);

  const setFlag = useCallback(
    (key: VacpHyperParamKey, value: boolean) => {
      if (!setVacpHyperParamStorageOverride(key, value)) return;
      refresh();
      setNeedsReload(true);
    },
    [refresh],
  );

  const clearFlag = useCallback(
    (key: VacpHyperParamKey) => {
      if (!clearVacpHyperParamStorageOverride(key)) return;
      refresh();
      setNeedsReload(true);
    },
    [refresh],
  );

  const enabledCount = useMemo(
    () => FLAG_ORDER.filter((key) => resolution.details[key].value).length,
    [resolution.details],
  );

  const reload = useCallback(() => {
    if (typeof window !== 'undefined') window.location.reload();
  }, []);

  return (
    <ModuleRoot
      rootRef={rootRef}
      boundWide={boundWide}
      className="vacp-debug-ui-settings flex flex-col"
      data-vacp-settings-module
    >
      <ModuleHeader
        title={
          <span className="flex min-w-0 items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-slate-100/64" aria-hidden="true" />
            <span>Feature flags</span>
          </span>
        }
        description="A URL query value for a flag overrides environment, browser storage, and defaults. Browser changes are stored locally and take effect after reload for install-time behavior."
        compact={compactPanel}
        className={cn(densePanel ? 'pb-2.5' : 'pb-3')}
        actions={
          <>
            <span className="rounded-full border border-white/[0.075] bg-white/[0.035] px-2.5 py-1 text-[11px] font-semibold text-slate-100/62">
              {enabledCount}/{FLAG_ORDER.length} on
            </span>
            <Button type="button" size={compactPanel ? 'iconSm' : 'sm'} variant="ghost" onClick={refresh}>
              <RefreshCcw className="h-4 w-4" aria-hidden="true" />
              <span className={compactPanel ? 'sr-only' : ''}>Refresh</span>
            </Button>
            <Button
              type="button"
              size={compactPanel ? 'iconSm' : 'sm'}
              variant={needsReload ? 'primary' : 'ghost'}
              disabled={!needsReload}
              onClick={reload}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              <span className={compactPanel ? 'sr-only' : ''}>Reload</span>
            </Button>
          </>
        }
      />
      <div className={cn('vacp-debug-ui-scroll min-h-0 flex-1 overflow-auto', compactPanel && 'pb-4')}>
        {FLAG_ORDER.map((key) => (
          <FlagRow
            key={key}
            id={key}
            detail={resolution.details[key]}
            compact={compactPanel}
            onSet={setFlag}
            onClear={clearFlag}
          />
        ))}
      </div>
    </ModuleRoot>
  );
}
