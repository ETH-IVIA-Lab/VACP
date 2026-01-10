import type { VacpActionCall, VacpRef } from '@vacp/core';
import { Braces, ClipboardCopy, Eraser, Play } from 'lucide-react';
import type { ReactElement } from 'react';
import { useMemo, useRef, useState } from 'react';

import { VACP_APPLY_STATE_ACTION } from '@vacp/core';

import { IconButton } from '@vacp/debug-ui/overlay/icon-button';
import { useElementSize } from '@vacp/debug-ui/overlay/hooks/use-element-size';
import { Card, CardDescription, CardHeader, CardTitle } from '@vacp/debug-ui/ui/components/ui/card';
import { JsonViewer } from '@vacp/debug-ui/ui/components/ui/json-viewer';
import { Textarea } from '@vacp/debug-ui/ui/components/ui/textarea';
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

export function JsonModule(props: VacpDebugModuleProps): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rootSize = useElementSize(rootRef);
  const showTwoCols = rootSize.width >= 980;
  const compactControls = rootSize.width < 520;
  const dense = rootSize.width < 520 || rootSize.height < 360;
  const iconButtonSize = 'iconSm';
  const snapshotText = useMemo(() => safeJson(props.runtime.currentState), [props.runtime.currentState]);
  const [overrideText, setOverrideText] = useState<string>(() => safeJson(props.runtime.currentState.state));
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const inlineCodeClass =
    'rounded-md border border-white/10 bg-slate-900/70 px-1.5 py-0.5 text-[11px] font-medium text-slate-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)]';

  const copy = async (text: string) => {
    const t = text ?? '';
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(t).catch(() => {});
      return;
    }
    const el = document.createElement('textarea');
    el.value = t;
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    document.body.append(el);
    el.select();
    try {
      document.execCommand('copy');
    } catch {
      // ignore
    } finally {
      el.remove();
    }
  };

  const applyOverride = () => {
    setError(null);
    try {
      const parsed = parseJson(overrideText);
      if (!parsed || typeof parsed !== 'object') throw new Error('Expected a JSON object keyed by vacp:// refs');
      if (typeof props.bridge.setStateOverride !== 'function') throw new Error('This provider does not support state overrides.');
      props.bridge.setStateOverride(parsed as Record<VacpRef, unknown>, { source: 'debug', message: 'override state' });
      setStatus('Override applied.');
    } catch (err) {
      setStatus('');
      setError(String(err));
    }
  };

  const applyToApp = async () => {
    setError(null);
    setStatus('Applying…');
    // Applying to the app mutates live state; keep the debug UI in live mode so changes are visible.
    if (props.runtime.mode === 'inspect' && typeof props.bridge.setMode === 'function') {
      props.bridge.setMode('live', { source: 'debug', message: 'auto: back to live for apply_state' });
    }
    let parsed: unknown;
    try {
      parsed = parseJson(overrideText);
      if (!parsed || typeof parsed !== 'object') throw new Error('Expected a JSON object keyed by vacp:// refs');
    } catch (err) {
      setStatus('');
      setError(String(err));
      return;
    }
    const call: VacpActionCall = { callId: crypto.randomUUID(), name: VACP_APPLY_STATE_ACTION, params: { state: parsed } };
    try {
      const res = typeof props.bridge.dispatch === 'function' ? await props.bridge.dispatch(call, { source: 'debug' }) : await props.bridge.execute(call);
      setStatus(res.ok ? 'Applied.' : res.error?.message ?? 'Apply failed');
      if (!res.ok) setError(res.error?.message ?? 'Apply failed');
    } catch (err) {
      setStatus('');
      setError(String(err));
    }
  };

  const clear = () => {
    props.bridge.clearOverrides?.({ source: 'debug', message: 'clear overrides' });
    setStatus('Overrides cleared.');
  };

  return (
    <div ref={rootRef} className={cn('grid h-full min-h-0', dense ? 'gap-2' : 'gap-3', showTwoCols && 'grid-cols-2')}>
      <Card className={cn('flex min-h-0 flex-col', dense && 'p-2')}>
        <CardHeader className={cn(compactControls && 'flex-col items-stretch gap-2')}>
          <div className="min-w-0">
            <CardTitle>State snapshot</CardTitle>
            <CardDescription>The current VACP state snapshot from the provider.</CardDescription>
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
              onClick={() => void copy(snapshotText)}
            />
          </div>
        </CardHeader>
        <JsonViewer value={props.runtime.currentState} className={cn(dense ? 'mt-2 flex-1 p-2' : 'mt-3 flex-1')} />
      </Card>

      <Card className={cn('flex min-h-0 flex-col', dense && 'p-2')}>
        <CardHeader className={cn(compactControls && 'flex-col items-stretch gap-2')}>
          <div className="min-w-0">
            <CardTitle>State edit</CardTitle>
            <CardDescription>
              Apply state for inspection (override) or execute <code className={inlineCodeClass}>vacp.apply_state</code>.
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

        <div className={cn(dense ? 'mt-2' : 'mt-3')}>
          <label className="text-[11px] font-medium text-slate-100/70" htmlFor="vacp-state-override">
            State map (JSON)
          </label>
          <Textarea
            id="vacp-state-override"
            className={cn('mt-1 text-[12px] leading-5', dense ? 'min-h-[180px]' : 'min-h-[260px]')}
            value={overrideText}
            onChange={(e) => setOverrideText(e.target.value)}
          />
        </div>

        {status ? <div className="mt-2 text-[11px] text-emerald-100/80">{status}</div> : null}
        {error ? <div className="mt-2 text-[11px] text-rose-100/80">{error}</div> : null}
      </Card>
    </div>
  );
}
