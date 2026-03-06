import type { VacpActionCall, VacpRef, VacpStateRequest, VacpStateUpdate } from '@vacp/core';
import { Braces, ClipboardCopy, Eraser, Play } from 'lucide-react';
import type { ReactElement } from 'react';
import { useMemo, useRef, useState } from 'react';

import { VACP_APPLY_STATE_ACTION } from '@vacp/core';

import { DEBUG_UI_PANEL_BREAKPOINTS, isDenseDebugPanel } from '@vacp/debug-ui/overlay/debug-ui-breakpoints';
import { IconButton } from '@vacp/debug-ui/overlay/icon-button';
import { useElementSize } from '@vacp/debug-ui/overlay/hooks/use-element-size';
import { Card, CardDescription, CardHeader, CardTitle } from '@vacp/debug-ui/ui/components/ui/card';
import { Input } from '@vacp/debug-ui/ui/components/ui/input';
import { JsonViewer } from '@vacp/debug-ui/ui/components/ui/json-viewer';
import { Textarea } from '@vacp/debug-ui/ui/components/ui/textarea';
import { copyTextToClipboard } from '@vacp/debug-ui/ui/lib/clipboard';
import { cn } from '@vacp/debug-ui/ui/lib/utils';

import type { VacpDebugModuleProps } from './module-types';

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseJson(text: string): unknown {
  const t = text.trim();
  if (!t) return undefined;
  return JSON.parse(t);
}

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
  const iconButtonSize = 'iconSm';
  const snapshotText = useMemo(() => safeJson(props.runtime.currentState), [props.runtime.currentState]);
  const [overrideText, setOverrideText] = useState<string>(() => safeJson(props.runtime.currentState.state));
  const [requestMode, setRequestMode] = useState<VacpStateRequest['mode']>('delta');
  const [requestSince, setRequestSince] = useState<string>('');
  const [requestRefsText, setRequestRefsText] = useState<string>('');
  const [requestIncludeSummary, setRequestIncludeSummary] = useState<boolean>(true);
  const [updatePayload, setUpdatePayload] = useState<unknown>(null);
  const [probeStatus, setProbeStatus] = useState<string>('');
  const [probeError, setProbeError] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<string>('');
  const [editError, setEditError] = useState<string | null>(null);
  const inlineCodeClass =
    'rounded-md border border-white/10 bg-slate-900/70 px-1.5 py-0.5 text-[11px] font-medium text-slate-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)]';
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
    try {
      const parsed = parseJson(overrideText);
      if (!parsed || typeof parsed !== 'object') throw new Error('Expected a JSON object keyed by vacp:// refs');
      if (typeof props.bridge.setStateOverride !== 'function')
        throw new Error('This provider does not support state overrides.');
      props.bridge.setStateOverride(parsed as Record<VacpRef, unknown>, { source: 'debug', message: 'override state' });
      setEditStatus('Override applied.');
    } catch (err) {
      setEditStatus('');
      setEditError(String(err));
    }
  };

  const applyToApp = async () => {
    setEditError(null);
    setEditStatus('Applying…');
    // Applying to the app mutates live state; keep the debug UI in live mode so changes are visible.
    if (props.runtime.mode === 'inspect' && typeof props.bridge.setMode === 'function') {
      props.bridge.setMode('live', { source: 'debug', message: 'auto: back to live for apply_state' });
    }
    let parsed: unknown;
    try {
      parsed = parseJson(overrideText);
      if (!parsed || typeof parsed !== 'object') throw new Error('Expected a JSON object keyed by vacp:// refs');
    } catch (err) {
      setEditStatus('');
      setEditError(String(err));
      return;
    }
    const call: VacpActionCall = {
      callId: crypto.randomUUID(),
      name: VACP_APPLY_STATE_ACTION,
      params: { state: parsed },
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
    <div ref={rootRef} className={cn('grid h-full min-h-0', dense ? 'gap-2' : 'gap-3', showTwoCols && 'grid-cols-2')}>
      <Card className={cn('flex min-h-0 flex-col overflow-hidden', dense && 'p-2')}>
        <CardHeader className={cn(compactControls && 'flex-col items-stretch gap-2')}>
          <div className="min-w-0">
            <CardTitle>JSON</CardTitle>
            <CardDescription>
              Inspect the raw provider snapshot and request explicit state update envelopes.
            </CardDescription>
          </div>
          <div
            className={cn(
              'flex items-center gap-2',
              compactControls
                ? 'w-full flex-nowrap justify-start overflow-x-auto gap-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
                : 'shrink-0',
            )}
          >
            <IconButton
              icon={<ClipboardCopy className="h-4 w-4 text-slate-100/90" />}
              label="Copy snapshot"
              title="Copy the current state snapshot JSON."
              size={iconButtonSize}
              onClick={() => void copyTextToClipboard(snapshotText)}
            />
          </div>
        </CardHeader>
        <JsonViewer
          value={props.runtime.currentState}
          className={cn(dense ? 'mt-2 max-h-[120px] flex-none p-2' : 'mt-3 max-h-[180px] flex-none')}
        />
        <details
          className={cn('mt-3 rounded-lg border border-white/10 bg-white/5', dense ? 'p-2' : 'p-3')}
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
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2.5 text-xs text-slate-100 outline-none focus:ring-2 focus:ring-sky-400/40"
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
                onClick={() => void copyTextToClipboard(safeJson(updatePayload))}
              />
            </div>

            {updateSummary ? (
              <div
                className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[11px] leading-5 text-slate-100/85"
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
            {probeStatus ? <div className="text-[11px] text-emerald-100/80">{probeStatus}</div> : null}
            {probeError ? <div className="text-[11px] text-rose-100/80">{probeError}</div> : null}
            {updatePayload ? (
              <details className="rounded-lg border border-white/10 bg-black/20 p-2">
                <summary className="cursor-pointer select-none text-[11px] font-medium text-slate-100/80">
                  Raw update payload
                </summary>
                <JsonViewer value={updatePayload} className="mt-2 max-h-[220px]" />
              </details>
            ) : null}
          </div>
        </details>
      </Card>

      <Card className={cn('flex min-h-0 flex-col overflow-hidden', dense && 'p-2')}>
        <CardHeader className={cn(compactControls && 'flex-col items-stretch gap-2')}>
          <div className="min-w-0">
            <CardTitle>State controls</CardTitle>
            <CardDescription>
              Edit a ref-keyed state map, apply it as an inspection override, or send it to the live app.
            </CardDescription>
          </div>
          <div
            className={cn(
              'flex items-center gap-2',
              compactControls
                ? 'w-full flex-nowrap justify-start overflow-x-auto gap-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
                : 'shrink-0 flex-wrap justify-end',
            )}
          >
            <IconButton
              icon={<Braces className="h-4 w-4 text-slate-100/90" />}
              label="Reset to current"
              title="Reset the editor to the current state."
              size={iconButtonSize}
              onClick={() => setOverrideText(safeJson(props.runtime.currentState.state))}
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
          </div>
        </CardHeader>

        <div className={cn('min-h-0 flex-1', dense ? 'mt-2' : 'mt-3')}>
          <label className="text-[11px] font-medium text-slate-100/70" htmlFor="vacp-state-override">
            State map (JSON)
          </label>
          <Textarea
            id="vacp-state-override"
            className={cn(
              'mt-1 h-full text-[12px] leading-5',
              dense ? 'min-h-[150px] max-h-[240px]' : 'min-h-[180px] max-h-[360px]',
            )}
            value={overrideText}
            onChange={(e) => setOverrideText(e.target.value)}
          />
        </div>

        {editStatus ? <div className="mt-2 text-[11px] text-emerald-100/80">{editStatus}</div> : null}
        {editError ? <div className="mt-2 text-[11px] text-rose-100/80">{editError}</div> : null}
      </Card>
    </div>
  );
}
