import type { VacpActionCall, VacpDataSqlResult, VacpNode, VacpRef } from '@vacp/core';
import { ClipboardCopy, Play, RefreshCw } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { VACP_DATA_SQL_ACTION } from '@vacp/core';

import { IconButton } from '../icon-button';

import type { VacpDebugModuleProps } from './module-types';

type DataHandleInfo = { ref: VacpRef; title: string };

function isDataSqlResult(value: unknown): value is VacpDataSqlResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as any;
  if (v.format === 'json') return Array.isArray(v.columns) && Array.isArray(v.rows);
  if (v.format === 'arrow_ipc_base64') return typeof v.arrowIpcBase64 === 'string';
  return false;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function defaultQuery(): string {
  return [
    'SELECT',
    '  COUNT(*)::INTEGER AS n_selected,',
    '  (SELECT COUNT(*)::INTEGER FROM vacp_all) AS n_all',
    'FROM vacp_handle;',
  ].join('\n');
}

function shortRef(ref: VacpRef): string {
  const s = String(ref);
  const hashIdx = s.indexOf('#');
  const clean = hashIdx >= 0 ? s.slice(0, hashIdx) : s;
  const parts = clean.split('/').filter(Boolean);
  return parts.slice(-2).join('/');
}

export function DataModule(props: VacpDebugModuleProps): ReactElement {
  const handles = useMemo(() => {
    const nodes = props.runtime.currentCapabilities.graph.nodes as VacpNode[];
    return nodes
      .filter((n) => n.kind === 'DataHandle')
      .map((n) => ({ ref: n.ref, title: n.title ?? shortRef(n.ref) }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [props.runtime.currentCapabilities]);

  const [selectedHandle, setSelectedHandle] = useState<VacpRef | null>(handles[0]?.ref ?? null);
  const [sqlByHandle, setSqlByHandle] = useState<Record<string, string>>({});
  const [result, setResult] = useState<unknown>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [activeCapabilitiesAt, setActiveCapabilitiesAt] = useState(props.runtime.currentCapabilities.createdAt);

  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  // If the visualization changes, reset the editor so queries don't drift.
  useEffect(() => {
    const next = props.runtime.currentCapabilities.createdAt;
    if (next === activeCapabilitiesAt) return;
    setActiveCapabilitiesAt(next);
    setSelectedHandle(handles[0]?.ref ?? null);
    setSqlByHandle({});
    setResult(null);
    setStatus('idle');
    setError(null);
  }, [props.runtime.currentCapabilities.createdAt, handles, activeCapabilitiesAt]);

  useEffect(() => {
    if (!selectedHandle) {
      setSelectedHandle(handles[0]?.ref ?? null);
      return;
    }
    if (!handles.some((h) => h.ref === selectedHandle)) {
      setSelectedHandle(handles[0]?.ref ?? null);
    }
  }, [handles, selectedHandle]);

  const selectedSql = selectedHandle ? (sqlByHandle[selectedHandle] ?? defaultQuery()) : '';

  const setSelectedSql = (sql: string) => {
    if (!selectedHandle) return;
    setSqlByHandle((m) => ({ ...m, [selectedHandle]: sql }));
  };

  const run = async () => {
    if (!selectedHandle) return;
    setStatus('running');
    setError(null);
    setResult(null);

    const call: VacpActionCall = {
      callId: crypto.randomUUID(),
      name: VACP_DATA_SQL_ACTION,
      params: {
        handleRef: selectedHandle,
        sql: selectedSql,
        format: 'json',
      },
    };

    try {
      const res = typeof props.bridge.dispatch === 'function' ? await props.bridge.dispatch(call, { source: 'debug' }) : await props.bridge.execute(call);
      if (!res.ok) {
        setStatus('error');
        setError(res.error?.message ?? 'Query failed');
        setResult(res.error ?? null);
        return;
      }
      setStatus('idle');
      setResult(res.result ?? null);
    } catch (err) {
      setStatus('error');
      setError(String(err));
      setResult(null);
    } finally {
      editorRef.current?.focus();
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

  const resultView = (() => {
    if (status === 'running') return <div className="vacp-debug-ui-small">Running…</div>;
    if (status === 'error') return <div className="vacp-debug-ui-small">{error ?? 'Query failed'}</div>;
    if (!result) return <div className="vacp-debug-ui-small">Run a query to see results.</div>;

    if (isDataSqlResult(result) && result.format === 'json') {
      return (
        <>
          <div className="vacp-debug-ui-small" style={{ marginBottom: 8 }}>
            Reserved relations: <code>vacp_handle</code> (selection) and <code>vacp_all</code> (full dataset).
          </div>
          <div className="vacp-debug-ui-scroll" style={{ maxHeight: 360 }}>
            <table className="vacp-debug-ui-table">
              <thead>
                <tr>
                  {result.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i}>
                    {result.columns.map((c) => (
                      <td key={c}>{String((row as any)[c] ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="vacp-debug-ui-details">
            <summary>Raw JSON</summary>
            <pre className="vacp-debug-ui-code" style={{ whiteSpace: 'pre-wrap' }}>
              {safeJson(result)}
            </pre>
          </details>
        </>
      );
    }

    return (
      <pre className="vacp-debug-ui-code" style={{ whiteSpace: 'pre-wrap' }}>
        {safeJson(result)}
      </pre>
    );
  })();

  return (
    <div className="vacp-debug-ui-page">
      <section className="vacp-debug-ui-card">
        <div className="vacp-debug-ui-card-header">
          <div>
            <div className="vacp-debug-ui-card-title">DuckDB SQL</div>
            <div className="vacp-debug-ui-card-subtitle">Query the current DataHandle via <code>vacp.data_sql</code>.</div>
          </div>
          <div className="vacp-debug-ui-toolbar">
            <IconButton
              icon={<Play className="vacp-debug-ui-icon" size={16} />}
              label="Run query"
              title="Run the SQL query against this handle."
              variant="primary"
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => void run()}
            />
            <IconButton
              icon={<RefreshCw className="vacp-debug-ui-icon" size={16} />}
              label="Refresh snapshots"
              title="Ask the provider to refresh its state snapshot."
              onClick={() => void refresh()}
            />
            <IconButton
              icon={<ClipboardCopy className="vacp-debug-ui-icon" size={16} />}
              label="Copy SQL"
              title="Copy the current SQL to clipboard."
              onClick={() => void copy(selectedSql)}
            />
          </div>
        </div>

        <div className="vacp-debug-ui-field">
          <label htmlFor="vacp-handle">Handle</label>
          <select id="vacp-handle" value={selectedHandle ?? ''} onChange={(e) => setSelectedHandle(e.target.value as VacpRef)}>
            {handles.map((h) => (
              <option key={h.ref} value={h.ref}>
                {h.title}
              </option>
            ))}
          </select>
        </div>

        <div className="vacp-debug-ui-field">
          <label htmlFor="vacp-sql">SQL</label>
          <textarea
            id="vacp-sql"
            ref={editorRef}
            data-vacp-focus="data-sql"
            style={{ minHeight: 160 }}
            value={selectedSql}
            onChange={(e) => setSelectedSql(e.target.value)}
          />
        </div>
      </section>

      <section className="vacp-debug-ui-card">
        <div className="vacp-debug-ui-card-header">
          <div>
            <div className="vacp-debug-ui-card-title">Result</div>
            <div className="vacp-debug-ui-card-subtitle">
              {selectedHandle ? (
                <>
                  Query target: <code>{shortRef(selectedHandle)}</code>
                </>
              ) : (
                'Select a DataHandle to query.'
              )}
            </div>
          </div>
        </div>
        <div style={{ paddingTop: 10 }}>{resultView}</div>
      </section>
    </div>
  );
}
