import type { VacpActionCall, VacpRef, VacpStateRequest, VacpStateUpdate } from '@vacp/core';
import { Braces, ClipboardCopy, Eraser, Play } from 'lucide-react';
import type { ReactElement } from 'react';
import { useMemo, useRef, useState } from 'react';

import { VACP_APPLY_STATE_ACTION } from '@vacp/core';

import { DEBUG_UI_PANEL_BREAKPOINTS, isDenseDebugPanel } from '@vacp/debug-ui/overlay/debug-ui-breakpoints';
import { IconButton } from '@vacp/debug-ui/overlay/icon-button';
import { useElementSize } from '@vacp/debug-ui/overlay/hooks/use-element-size';
import { Input } from '@vacp/debug-ui/ui/components/ui/input';
import { JsonEditor } from '@vacp/debug-ui/ui/components/ui/json-editor';
import { stringifyJson } from '@vacp/debug-ui/ui/components/ui/json-theme';
import { JsonViewer } from '@vacp/debug-ui/ui/components/ui/json-viewer';
import { copyTextToClipboard } from '@vacp/debug-ui/ui/lib/clipboard';
import { cn } from '@vacp/debug-ui/ui/lib/utils';

import { ModuleField, ModuleHeader, ModulePane, ModuleRoot } from './module-layout';
import type { VacpDebugModuleProps } from './module-types';

function parseRefs(text: string): VacpRef[] | undefined {
  const refs = text
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  if (refs.length === 0) return undefined;
  return refs as VacpRef[];
}

function isStateUpdate(value: unknown): value is VacpStateUpdate {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return typeof rec.mode === 'string' && typeof rec.token === 'string';
}

export function JsonModule(props: VacpDebugModuleProps): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rootSize = useElementSize(rootRef);
  const showTwoCols = rootSize.width >= DEBUG_UI_PANEL_BREAKPOINTS.splitPane;
  const compactControls = rootSize.width < DEBUG_UI_PANEL_BREAKPOINTS.compactControls;
  const dense = isDenseDebugPanel(rootSize.width, rootSize.height);
  const boundWide = rootSize.width >= DEBUG_UI_PANEL_BREAKPOINTS.splitPane;
  const iconButtonSize = 'iconSm';
  const snapshotText = useMemo(() => stringifyJson(props.runtime.currentState), [props.runtime.currentState]);
  const [overrideValue, setOverrideValue] = useState<unknown>(() => props.runtime.currentState.state);
  const [overrideEditorError, setOverrideEditorError] = useState<string | null>(null);
  const [overrideResetSignal, setOverrideResetSignal] = useState(0);
  const [requestMode, setRequestMode] = useState<VacpStateRequest['mode']>('delta');
  const [requestSince, setRequestSince] = useState<string>('');
  const [requestRefsText, setRequestRefsText] = useState<string>('');
  const [requestIncludeSummary, setRequestIncludeSummary] = useState<boolean>(true);
  const [updatePayload, setUpdatePayload] = useState<unknown>(null);
  const [probeStatus, setProbeStatus] = useState<string>('');
  const [probeError, setProbeError] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<string>('');
  const [editError, setEditError] = useState<string | null>(null);
  const updateSummary = useMemo(() => {
    if (!isStateUpdate(updatePayload)) return null;
    if (updatePayload.mode === 'full') {
      const refCount = Object.keys(updatePayload.snapshot.state ?? {}).length;
      const summaryRefCount = Object.keys(updatePayload.snapshot.summary ?? {}).length;
      return {
        mode: 'full' as const,
        token: updatePayload.token,
        refCount,
        summaryRefCount,
      };
    }
    const changedCount = Object.keys(updatePayload.delta.changed ?? {}).length;
    const removedCount = updatePayload.delta.removed?.length ?? 0;
    const summaryChangedCount = Object.keys(updatePayload.delta.summaryChanged ?? {}).length;
    const summaryRemovedCount = updatePayload.delta.summaryRemoved?.length ?? 0;
    return {
      mode: 'delta' as const,
      token: updatePayload.token,
      baseToken: updatePayload.baseToken,
      changedCount,
      removedCount,
      summaryChangedCount,
      summaryRemovedCount,
    };
  }, [updatePayload]);

  const requestStateUpdate = async (modeOverride?: VacpStateRequest['mode']) => {
    setProbeError(null);
    setProbeStatus('Requesting state update…');
    try {
      const refs = parseRefs(requestRefsText);
      const request: VacpStateRequest = {
        mode: modeOverride ?? requestMode ?? 'delta',
        includeSummary: requestIncludeSummary,
        ...(requestSince.trim() ? { since: requestSince.trim() } : {}),
        ...(refs ? { refs } : {}),
      };
      const update = await props.bridge.getState(request);
      setUpdatePayload(update);
      setProbeStatus(`Received ${update.mode} update.`);
      return update;
    } catch (err) {
      setProbeStatus('');
      setProbeError(String(err));
      return null;
    }
  };

  const seedSinceFromFull = async () => {
    const full = await requestStateUpdate('full');
    if (full && full.mode === 'full') setRequestSince(full.token);
  };

  const applyOverride = () => {
    setEditError(null);
    if (overrideEditorError) {
      setEditStatus('');
      setEditError(overrideEditorError);
      return;
    }
    if (!overrideValue || typeof overrideValue !== 'object' || Array.isArray(overrideValue)) {
      setEditStatus('');
      setEditError('Expected a JSON object keyed by vacp:// refs');
      return;
    }
    if (typeof props.bridge.setStateOverride !== 'function') {
      setEditStatus('');
      setEditError('This provider does not support state overrides.');
      return;
    }
    props.bridge.setStateOverride(overrideValue as Record<VacpRef, unknown>, {
      source: 'debug',
      message: 'override state',
    });
    setEditStatus('Override applied.');
  };

  const applyToApp = async () => {
    setEditError(null);
    setEditStatus('Applying…');
    // Applying to the app mutates live state; keep the debug UI in live mode so changes are visible.
    if (props.runtime.mode === 'inspect' && typeof props.bridge.setMode === 'function') {
      props.bridge.setMode('live', { source: 'debug', message: 'auto: back to live for apply_state' });
    }
    if (overrideEditorError) {
      setEditStatus('');
      setEditError(overrideEditorError);
      return;
    }
    if (!overrideValue || typeof overrideValue !== 'object' || Array.isArray(overrideValue)) {
      setEditStatus('');
      setEditError('Expected a JSON object keyed by vacp:// refs');
      return;
    }
    const call: VacpActionCall = {
      callId: crypto.randomUUID(),
      name: VACP_APPLY_STATE_ACTION,
      params: { state: overrideValue },
    };
    try {
      const res =
        typeof props.bridge.dispatch === 'function'
          ? await props.bridge.dispatch(call, { source: 'debug' })
          : await props.bridge.execute(call);
      setEditStatus(res.ok ? 'Applied.' : (res.error?.message ?? 'Apply failed'));
      if (!res.ok) setEditError(res.error?.message ?? 'Apply failed');
    } catch (err) {
      setEditStatus('');
      setEditError(String(err));
    }
  };

  const clear = () => {
    props.bridge.clearOverrides?.({ source: 'debug', message: 'clear overrides' });
    setEditStatus('Overrides cleared.');
  };

  return (
    <ModuleRoot
      rootRef={rootRef}
      boundWide={boundWide}
      className={cn('grid h-full min-h-0', dense ? 'gap-2' : 'gap-3', showTwoCols && 'grid-cols-2')}
    >
      <ModulePane className={cn('flex min-h-0 flex-col overflow-hidden', dense ? 'gap-2' : 'gap-3')}>
        <ModuleHeader
          title="Snapshot"
          description="Inspect the raw provider snapshot."
          compact={compactControls}
          actions={
            <IconButton
              icon={<ClipboardCopy className="h-4 w-4 text-slate-100/90" />}
              label="Copy snapshot"
              title="Copy the current state snapshot JSON."
              size={iconButtonSize}
              onClick={() => void copyTextToClipboard(snapshotText)}
            />
          }
        />
        <JsonViewer
          value={props.runtime.currentState}
          className={cn('flex-1', dense ? 'min-h-[96px] p-2' : 'min-h-[160px]')}
        />
        <details
          className={cn('border-t border-white/[0.075]', dense ? 'pt-2' : 'pt-3')}
          data-vacp-state-update="panel"
        >
          <summary className="cursor-pointer select-none text-[12px] font-semibold text-slate-100/90">
            Update probe
          </summary>
          <div className="mt-3 space-y-3">
            <div
              className={cn(
                'grid gap-2',
                rootSize.width >= 880 ? 'grid-cols-4' : rootSize.width >= 620 ? 'grid-cols-2' : 'grid-cols-1',
              )}
            >
              <label className="text-[11px] text-slate-100/80">
                Mode
                <select
                  data-vacp-state-update="mode"
                  className="mt-1 w-full rounded-lg border border-white/[0.08] bg-[#101821]/72 px-3 py-2.5 text-xs text-slate-100/90 outline-none focus:border-white/22 focus:ring-2 focus:ring-white/22"
                  value={requestMode ?? 'delta'}
                  onChange={(e) => setRequestMode(e.target.value as VacpStateRequest['mode'])}
                >
                  <option value="auto">auto</option>
                  <option value="full">full</option>
                  <option value="delta">delta</option>
                </select>
              </label>
              <label className="text-[11px] text-slate-100/80">
                Since token
                <Input
                  data-vacp-state-update="since"
                  className="mt-1"
                  placeholder="st_..."
                  value={requestSince}
                  onChange={(e) => setRequestSince(e.target.value)}
                />
              </label>
              <label className="text-[11px] text-slate-100/80">
                Refs (comma/space)
                <Input
                  data-vacp-state-update="refs"
                  className="mt-1"
                  placeholder="vacp://... vacp://..."
                  value={requestRefsText}
                  onChange={(e) => setRequestRefsText(e.target.value)}
                />
              </label>
              <label className="inline-flex items-center gap-2 self-end pb-1 text-[11px] text-slate-100/85">
                <input
                  type="checkbox"
                  data-vacp-state-update="include-summary"
                  checked={requestIncludeSummary}
                  onChange={(e) => setRequestIncludeSummary(e.target.checked)}
                />
                include summary
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <IconButton
                icon={<Play className="h-4 w-4 text-slate-100/90" />}
                label="Request update"
                title="Call getState(request) with the current probe options."
                variant="primary"
                size={iconButtonSize}
                onClick={() => void requestStateUpdate()}
              />
              <IconButton
                icon={<Braces className="h-4 w-4 text-slate-100/90" />}
                label="Seed since from full"
                title="Fetch a full update and set its token as the next 'since' baseline."
                size={iconButtonSize}
                onClick={() => void seedSinceFromFull()}
              />
              <IconButton
                icon={<ClipboardCopy className="h-4 w-4 text-slate-100/90" />}
                label="Copy update"
                title="Copy the latest state update payload."
                size={iconButtonSize}
                onClick={() => void copyTextToClipboard(stringifyJson(updatePayload))}
              />
            </div>

            {updateSummary ? (
              <div
                className="rounded-lg border border-white/[0.075] bg-white/[0.02] px-3 py-2 text-[11px] leading-5 text-slate-100/76"
                data-vacp-state-update="summary"
              >
                {updateSummary.mode === 'full' ? (
                  <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-2">
                    <div className="min-w-0 break-words">
                      <dt className="inline text-slate-100/60">mode:</dt> <dd className="inline">full</dd>
                    </div>
                    <div className="min-w-0 break-words">
                      <dt className="inline text-slate-100/60">token:</dt>{' '}
                      <dd className="inline font-medium text-slate-100">{updateSummary.token}</dd>
                    </div>
                    <div className="min-w-0 break-words">
                      <dt className="inline text-slate-100/60">refs:</dt>{' '}
                      <dd className="inline">{updateSummary.refCount}</dd>
                    </div>
                    <div className="min-w-0 break-words">
                      <dt className="inline text-slate-100/60">summary refs:</dt>{' '}
                      <dd className="inline">{updateSummary.summaryRefCount}</dd>
                    </div>
                  </dl>
                ) : (
                  <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-2">
                    <div className="min-w-0 break-words">
                      <dt className="inline text-slate-100/60">mode:</dt> <dd className="inline">delta</dd>
                    </div>
                    <div className="min-w-0 break-words">
                      <dt className="inline text-slate-100/60">token:</dt>{' '}
                      <dd className="inline font-medium text-slate-100">{updateSummary.token}</dd>
                    </div>
                    <div className="min-w-0 break-words">
                      <dt className="inline text-slate-100/60">base:</dt>{' '}
                      <dd className="inline font-medium text-slate-100">{updateSummary.baseToken}</dd>
                    </div>
                    <div className="min-w-0 break-words">
                      <dt className="inline text-slate-100/60">changed:</dt>{' '}
                      <dd className="inline">{updateSummary.changedCount}</dd>
                    </div>
                    <div className="min-w-0 break-words">
                      <dt className="inline text-slate-100/60">removed:</dt>{' '}
                      <dd className="inline">{updateSummary.removedCount}</dd>
                    </div>
                    <div className="min-w-0 break-words">
                      <dt className="inline text-slate-100/60">summary changed:</dt>{' '}
                      <dd className="inline">{updateSummary.summaryChangedCount}</dd>
                    </div>
                    <div className="min-w-0 break-words">
                      <dt className="inline text-slate-100/60">summary removed:</dt>{' '}
                      <dd className="inline">{updateSummary.summaryRemovedCount}</dd>
                    </div>
                  </dl>
                )}
              </div>
            ) : null}
            {probeStatus ? <div className="text-[11px] text-slate-100/68">{probeStatus}</div> : null}
            {probeError ? <div className="text-[11px] text-red-50/84">{probeError}</div> : null}
            {updatePayload ? (
              <details className="border-t border-white/[0.075] pt-2">
                <summary className="cursor-pointer select-none text-[11px] font-medium text-slate-100/80">
                  Raw update payload
                </summary>
                <JsonViewer value={updatePayload} className="mt-2 max-h-[220px]" />
              </details>
            ) : null}
          </div>
        </details>
      </ModulePane>

      <ModulePane className={cn('flex min-h-0 flex-col overflow-hidden', dense ? 'gap-2' : 'gap-3')}>
        <ModuleHeader
          title="State controls"
          description="Edit a ref-keyed state map, apply it as an inspection override, or send it to the live app."
          compact={compactControls}
          actions={
            <>
              <IconButton
                icon={<Braces className="h-4 w-4 text-slate-100/90" />}
                label="Reset to current"
                title="Reset the editor to the current state."
                size={iconButtonSize}
                onClick={() => {
                  setOverrideValue(props.runtime.currentState.state);
                  setOverrideEditorError(null);
                  setOverrideResetSignal((value) => value + 1);
                }}
              />
              <IconButton
                icon={<Play className="h-4 w-4 text-slate-100/90" />}
                label="Apply override"
                title="Apply this state as an override for inspection (does not affect the live app)."
                variant="primary"
                size={iconButtonSize}
                onClick={() => applyOverride()}
              />
              <IconButton
                icon={<Play className="h-4 w-4 text-slate-100/90" />}
                label="Apply to app"
                title="Execute vacp.apply_state against the live app."
                size={iconButtonSize}
                onClick={() => void applyToApp()}
              />
              <IconButton
                icon={<Eraser className="h-4 w-4 text-slate-100/90" />}
                label="Clear overrides"
                title="Clear any inspection overrides."
                size={iconButtonSize}
                onClick={() => clear()}
              />
            </>
          }
        />

        <ModuleField
          label="State map (JSON)"
          htmlFor="vacp-state-override"
          className="flex min-h-0 flex-1 flex-col"
          innerClassName="min-h-0 flex-1"
        >
          <JsonEditor
            id="vacp-state-override"
            className="h-full"
            minHeightClassName={dense ? 'min-h-[180px]' : 'min-h-[260px]'}
            value={overrideValue}
            onChange={setOverrideValue}
            onValidityChange={setOverrideEditorError}
            resetSignal={overrideResetSignal}
          />
        </ModuleField>

        {editStatus ? <div className="text-[11px] text-slate-100/68">{editStatus}</div> : null}
        {editError ? <div className="text-[11px] text-red-50/84">{editError}</div> : null}
      </ModulePane>
    </ModuleRoot>
  );
}
