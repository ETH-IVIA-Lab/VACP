import type { VacpActionCall, VacpActionDescriptor, VacpActionResult } from '@vacp/core';
import { ClipboardCopy, Play, RefreshCw } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';

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

export function ActionsModule(props: VacpDebugModuleProps): ReactElement {
  const actions = props.runtime.currentCapabilities.graph.actions ?? [];
  const [filter, setFilter] = useState('');
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => a.name.toLowerCase().includes(q) || (a.description ?? '').toLowerCase().includes(q));
  }, [actions, filter]);

  const [selectedName, setSelectedName] = useState<string>(actions[0]?.name ?? '');
  const selected: VacpActionDescriptor | null = useMemo(
    () => actions.find((a) => a.name === selectedName) ?? actions[0] ?? null,
    [actions, selectedName],
  );

  const [paramsText, setParamsText] = useState<string>('{}');
  const [result, setResult] = useState<VacpActionResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selected) return;
    setSelectedName(selected.name);
    setParamsText('{}');
    setResult(null);
    setStatus('idle');
    setError(null);
  }, [selected?.name]);

  const run = async () => {
    if (!selected) return;
    setStatus('running');
    setError(null);
    setResult(null);
    let params: unknown;
    try {
      params = parseJson(paramsText);
    } catch (err) {
      setStatus('error');
      setError(`Invalid JSON params: ${String(err)}`);
      return;
    }

    const call: VacpActionCall = { callId: crypto.randomUUID(), name: selected.name, params };
    try {
      const res = typeof props.bridge.dispatch === 'function' ? await props.bridge.dispatch(call, { source: 'debug' }) : await props.bridge.execute(call);
      setResult(res);
      setStatus(res.ok ? 'idle' : 'error');
      if (!res.ok) setError(res.error?.message ?? 'Action failed');
    } catch (err) {
      setStatus('error');
      setError(String(err));
    }
  };

  const refresh = async () => {
    if (typeof props.bridge.refresh !== 'function') return;
    await props.bridge.refresh({ source: 'debug', message: 'refresh' });
  };

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

  return (
    <div className="vacp-debug-ui-page">
      <div className="vacp-debug-ui-grid vacp-debug-ui-grid-2" style={{ height: '100%' }}>
        <section className="vacp-debug-ui-card" style={{ display: 'grid', gridTemplateRows: 'auto auto 1fr' }}>
          <div className="vacp-debug-ui-card-header">
            <div>
              <div className="vacp-debug-ui-card-title">Actions</div>
              <div className="vacp-debug-ui-card-subtitle">Dispatch semantic actions (human/agent parity).</div>
            </div>
            <div className="vacp-debug-ui-toolbar">
              <IconButton
                icon={<RefreshCw className="vacp-debug-ui-icon" size={16} />}
                label="Refresh snapshots"
                title="Ask the provider to refresh its state snapshot."
                onClick={() => void refresh()}
              />
            </div>
          </div>
          <div className="vacp-debug-ui-field" style={{ margin: 0 }}>
            <label htmlFor="vacp-action-filter">Filter</label>
            <input id="vacp-action-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search…" />
          </div>
          <div className="vacp-debug-ui-scroll" style={{ maxHeight: 520 }}>
            <div className="vacp-debug-ui-list">
              {filtered.map((a) => (
                <div
                  key={a.name}
                  className="vacp-debug-ui-row"
                  aria-selected={a.name === (selected?.name ?? '') ? 'true' : 'false'}
                  onClick={() => setSelectedName(a.name)}
                >
                  <div style={{ fontWeight: 600 }}>{a.name}</div>
                  <div className="vacp-debug-ui-small" style={{ opacity: 0.85 }}>
                    {a.description}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="vacp-debug-ui-card" style={{ display: 'grid', gridTemplateRows: 'auto 1fr' }}>
          <div className="vacp-debug-ui-card-header">
            <div>
              <div className="vacp-debug-ui-card-title">{selected ? selected.name : 'Select an action'}</div>
              <div className="vacp-debug-ui-card-subtitle">{selected?.description ?? ''}</div>
            </div>
            <div className="vacp-debug-ui-toolbar">
              <IconButton
                icon={<Play className="vacp-debug-ui-icon" size={16} />}
                label="Run action"
                title="Execute this action with the current JSON params."
                variant="primary"
                onClick={() => void run()}
              />
              <IconButton
                icon={<ClipboardCopy className="vacp-debug-ui-icon" size={16} />}
                label="Copy result"
                title="Copy the last result JSON to clipboard."
                onClick={() => void copy(safeJson(result))}
              />
            </div>
          </div>
          <div style={{ display: 'grid', gap: 12, minHeight: 0 }}>
            <div className="vacp-debug-ui-field" style={{ margin: 0 }}>
              <label htmlFor="vacp-action-params">Params (JSON)</label>
              <textarea
                id="vacp-action-params"
                value={paramsText}
                onChange={(e) => setParamsText(e.target.value)}
                style={{ minHeight: 120 }}
              />
            </div>

            <div className="vacp-debug-ui-field" style={{ margin: 0 }}>
              <label>Result</label>
              <pre className="vacp-debug-ui-code" style={{ minHeight: 0, whiteSpace: 'pre-wrap' }}>
                {status === 'running' ? 'Running…' : status === 'error' ? error ?? 'Action failed' : safeJson(result)}
              </pre>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
