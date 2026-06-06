import { CheckCircle2, Lock, RefreshCcw, RotateCcw, SlidersHorizontal, Trash2, XCircle } from 'lucide-react';
import type { ReactElement } from 'react';
import { useCallback, useMemo, useState } from 'react';

import {
  clearVacpHyperParamStorageOverride,
  getVacpHyperParamResolution,
  setVacpHyperParamStorageOverride,
  type VacpHyperParamDetail,
  type VacpHyperParamKey,
  type VacpHyperParamSource,
} from '@vacp/core';
import { Button } from '@vacp/debug-ui/ui/components/ui/button';
import { cn } from '@vacp/debug-ui/ui/lib/utils';

type FlagCopy = Readonly<{
  label: string;
  effect: string;
  onText: string;
  offText: string;
}>;

const FLAG_ORDER = ['debugUi', 'exposeBridge', 'domSnapshot', 'enableSql'] as const satisfies readonly VacpHyperParamKey[];

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
        'vacp-debug-ui-switch relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-[background-color,border-color,opacity]',
        props.checked ? 'border-emerald-200/24 bg-emerald-300/10' : 'border-white/[0.075] bg-[#101821]/76',
        props.disabled ? 'cursor-not-allowed opacity-42' : 'cursor-pointer hover:border-white/18',
      )}
      onClick={() => props.onChange(!props.checked)}
    >
      <span
        className={cn(
          'inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-200/88 text-slate-950/70 shadow-sm transition-transform',
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
    <section className="vacp-debug-ui-settings-row grid gap-3 border-t border-white/[0.075] py-4 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="truncate text-[13px] font-semibold text-slate-50">{copy.label}</h3>
          <SourceBadge source={props.detail.source} />
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[11px] font-semibold',
              props.detail.value ? 'bg-emerald-300/[0.075] text-emerald-50/76' : 'bg-white/[0.035] text-slate-100/56',
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
      <div className="flex shrink-0 items-center gap-2 sm:justify-end">
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
        <div className="rounded-md border border-amber-100/14 bg-amber-100/[0.055] px-3 py-2 text-[11px] leading-5 text-amber-50/68 sm:col-span-2">
          Browser changes are disabled while a higher-priority {SOURCE_LABELS[props.detail.source].toLowerCase()} value
          is active.
        </div>
      ) : null}
    </section>
  );
}

export function SettingsModule(): ReactElement {
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
    <div className="vacp-debug-ui-settings flex h-full min-h-0 flex-col" data-vacp-settings-module>
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-white/[0.075] pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-emerald-50/62" aria-hidden="true" />
            <h2 className="text-[13px] font-semibold text-slate-50">VACP Settings</h2>
          </div>
          <p className="mt-1 max-w-[78ch] text-[12px] leading-5 text-slate-100/64">
            A URL query value for a flag overrides environment, browser storage, and defaults. Browser changes are
            stored locally and take effect after reload for install-time behavior.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="rounded-full border border-white/[0.075] bg-white/[0.035] px-2.5 py-1 text-[11px] font-semibold text-slate-100/62">
            {enabledCount}/{FLAG_ORDER.length} on
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={refresh}>
            <RefreshCcw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
          <Button
            type="button"
            size="sm"
            variant={needsReload ? 'primary' : 'ghost'}
            disabled={!needsReload}
            onClick={reload}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Reload
          </Button>
        </div>
      </div>
      <div className="vacp-debug-ui-scroll min-h-0 flex-1 overflow-auto">
        {FLAG_ORDER.map((key) => (
          <FlagRow key={key} id={key} detail={resolution.details[key]} onSet={setFlag} onClear={clearFlag} />
        ))}
      </div>
    </div>
  );
}
