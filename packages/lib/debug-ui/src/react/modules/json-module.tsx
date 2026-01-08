import type { VacpActionCall, VacpRef } from '@vacp/core';
import { Braces, ClipboardCopy, Eraser, Play } from 'lucide-react';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';

import { VACP_APPLY_STATE_ACTION } from '@vacp/core';

import { IconButton } from '../icon-button';

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
  const snapshotText = useMemo(() => safeJson(props.runtime.currentState), [props.runtime.currentState]);
  const [overrideText, setOverrideText] = useState<string>(() => safeJson(props.runtime.currentState.state));
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

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
    <div className="vacp-debug-ui-page">
      <section className="vacp-debug-ui-card">
        <div className="vacp-debug-ui-card-header">
          <div>
            <div className="vacp-debug-ui-card-title">State snapshot</div>
            <div className="vacp-debug-ui-card-subtitle">The current VACP state snapshot from the provider.</div>
          </div>
          <div className="vacp-debug-ui-toolbar">
            <IconButton
              icon={<ClipboardCopy className="vacp-debug-ui-icon" size={16} />}
              label="Copy snapshot"
              title="Copy the current state snapshot JSON."
              onClick={() => void copy(snapshotText)}
            />
          </div>
        </div>
        <pre className="vacp-debug-ui-code" style={{ whiteSpace: 'pre-wrap' }}>
          {snapshotText}
        </pre>
      </section>

      <section className="vacp-debug-ui-card">
        <div className="vacp-debug-ui-card-header">
          <div>
            <div className="vacp-debug-ui-card-title">State edit</div>
            <div className="vacp-debug-ui-card-subtitle">
              Apply state for inspection (override) or execute <code>vacp.apply_state</code>.
            </div>
          </div>
          <div className="vacp-debug-ui-toolbar">
            <IconButton
              icon={<Braces className="vacp-debug-ui-icon" size={16} />}
              label="Reset to current"
              title="Reset the editor to the current state."
              onClick={() => setOverrideText(safeJson(props.runtime.currentState.state))}
            />
            <IconButton
              icon={<Play className="vacp-debug-ui-icon" size={16} />}
              label="Apply override"
              title="Apply this state as an override for inspection (does not affect the live app)."
              variant="primary"
              onClick={() => applyOverride()}
            />
            <IconButton
              icon={<Play className="vacp-debug-ui-icon" size={16} />}
              label="Apply to app"
              title="Execute vacp.apply_state against the live app."
              onClick={() => void applyToApp()}
            />
            <IconButton
              icon={<Eraser className="vacp-debug-ui-icon" size={16} />}
              label="Clear overrides"
              title="Clear any inspection overrides."
              onClick={() => clear()}
            />
          </div>
        </div>
        <div className="vacp-debug-ui-field" style={{ margin: 0 }}>
          <label htmlFor="vacp-state-override">State map (JSON)</label>
          <textarea id="vacp-state-override" value={overrideText} onChange={(e) => setOverrideText(e.target.value)} style={{ minHeight: 200 }} />
        </div>
        {status ? <div className="vacp-debug-ui-small">{status}</div> : null}
        {error ? <div className="vacp-debug-ui-small">{error}</div> : null}
      </section>
    </div>
  );
}
