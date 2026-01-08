import type { VacpActionCall, VacpDataSqlResult, VacpNode, VacpRef } from '@vacp/core';
import { ClipboardCopy, Play, RefreshCw } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { VACP_DATA_SQL_ACTION } from '@vacp/core';

import { IconButton } from '@vacp/debug-ui/overlay/icon-button';
import { useVacpDebugUiStore } from '@vacp/debug-ui/overlay/debug-store';
import { Card, CardDescription, CardHeader, CardTitle } from '@vacp/debug-ui/ui/components/ui/card';
import { Textarea } from '@vacp/debug-ui/ui/components/ui/textarea';

import type { VacpDebugModuleProps } from './module-types';

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
  const parts = clean.split('/').filter(Boolean).filter((p) => p !== 'vacp:');
  // Prefer including the surface id, e.g. `plot-0/data/main` instead of just `data/main`.
  return parts.slice(-3).join('/');
}

export function DataModule(props: VacpDebugModuleProps): ReactElement {
  const inlineCodeClass =
    'rounded-md border border-white/10 bg-slate-900/70 px-1.5 py-0.5 text-[11px] font-medium text-slate-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)]';
  const selectClass =
    'mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-xs text-slate-100 outline-none focus:ring-2 focus:ring-sky-400/40';

  const handleRefs = useMemo(() => {
    const nodes = props.runtime.currentCapabilities.graph.nodes as VacpNode[];
    return nodes.filter((n) => n.kind === 'DataHandle').map((n) => n.ref);
  }, [props.runtime.currentCapabilities]);

  const handles = useMemo(() => {
    const nodes = props.runtime.currentCapabilities.graph.nodes as VacpNode[];
    return nodes
      .filter((n) => n.kind === 'DataHandle')
      .map((n) => {
        const title = n.title ?? shortRef(n.ref);
        return { ref: n.ref, title, label: `${title} — ${shortRef(n.ref)}` };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [props.runtime.currentCapabilities]);

  const selectedHandle = useVacpDebugUiStore((s) => s.dataSelectedHandleRef);
  const sqlByHandle = useVacpDebugUiStore((s) => s.dataSqlByHandleRef);
  const lastResult = useVacpDebugUiStore((s) => s.dataLastResult);
  const lastError = useVacpDebugUiStore((s) => s.dataLastError);
  const graphSig = useVacpDebugUiStore((s) => s.dataGraphSignature);
  const setGraphSig = useVacpDebugUiStore((s) => s.setDataGraphSignature);
  const setSelectedHandle = useVacpDebugUiStore((s) => s.setDataSelectedHandleRef);
  const setSqlForHandle = useVacpDebugUiStore((s) => s.setDataSqlForHandle);
  const setLastResult = useVacpDebugUiStore((s) => s.setDataLastResult);
  const resetDataModule = useVacpDebugUiStore((s) => s.resetDataModule);

  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle');

  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  const graphSignature = useMemo(
    () => handleRefs.map((r) => String(r)).sort().join('|'),
    [handleRefs],
  );

  // If the visualization changes (different handles/graph), reset the editor so queries don't drift.
  useEffect(() => {
    if (graphSignature && graphSig === graphSignature) return;
    resetDataModule();
    if (graphSignature) setGraphSig(graphSignature);
    setStatus('idle');
    setLastResult({ result: null, error: null });
  }, [graphSig, graphSignature, resetDataModule, setGraphSig, setLastResult]);

  useEffect(() => {
    if (!selectedHandle) {
      setSelectedHandle(handles[0]?.ref ?? null);
      return;
    }
    if (!handles.some((h) => h.ref === selectedHandle)) {
      setSelectedHandle(handles[0]?.ref ?? null);
    }
  }, [handles, selectedHandle, setSelectedHandle]);

  const selectedSql = selectedHandle ? (sqlByHandle[selectedHandle] ?? defaultQuery()) : '';
  const selectedHandleTitle = useMemo(() => {
    if (!selectedHandle) return null;
    const found = handles.find((h) => h.ref === selectedHandle);
    return found?.title ?? null;
  }, [handles, selectedHandle]);

  const setSelectedSql = (sql: string) => {
    if (!selectedHandle) return;
    setSqlForHandle(selectedHandle, sql);
  };

  const run = async () => {
    if (!selectedHandle) return;
    setStatus('running');
    setLastResult({ result: null, error: null });

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
        setLastResult({ result: res.error ?? null, error: res.error?.message ?? 'Query failed' });
        return;
      }
      setStatus('idle');
      setLastResult({ result: res.result ?? null, error: null });
    } catch (err) {
      setStatus('error');
      setLastResult({ result: null, error: String(err) });
    } finally {
      requestAnimationFrame(() => editorRef.current?.focus());
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
    if (status === 'running') return <div className="text-[12px] text-slate-100/80">Running…</div>;
    if (status === 'error') return <div className="text-[12px] text-rose-100/80">{lastError ?? 'Query failed'}</div>;
    if (lastResult == null) return <div className="text-[12px] text-slate-100/80">Run a query to see results.</div>;

    if (isDataSqlResult(lastResult) && lastResult.format === 'json') {
      return (
        <>
          <div className="text-[12px] text-slate-100/80">
            Query relations: <code className={inlineCodeClass}>vacp_handle</code> (current selection) and <code className={inlineCodeClass}>vacp_all</code> (full dataset).
          </div>
          <div className="mt-2 overflow-auto rounded-lg border border-white/10 bg-black/20">
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0 bg-slate-950/90">
                <tr>
                  {lastResult.columns.map((c) => (
                    <th key={c} className="border-b border-white/10 px-2 py-1 text-left font-semibold text-slate-100/85">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lastResult.rows.map((row, i) => (
                  <tr key={i} className="odd:bg-white/[0.02]">
                    {lastResult.columns.map((c) => (
                      <td key={c} className="border-b border-white/5 px-2 py-1 text-slate-100/85">
                        {String((row as any)[c] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="mt-3 rounded-lg border border-white/10 bg-black/10 px-3 py-2">
            <summary className="cursor-pointer text-[12px] text-slate-100/80">Raw JSON</summary>
            <pre className="mt-2 overflow-auto rounded-lg border border-white/10 bg-black/20 p-3 text-[12px] leading-5 text-slate-100/85">
              {safeJson(lastResult)}
            </pre>
          </details>
        </>
      );
    }

    return (
      <pre className="overflow-auto rounded-lg border border-white/10 bg-black/20 p-3 text-[12px] leading-5 text-slate-100/85">
        {safeJson(lastResult)}
      </pre>
    );
  })();

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
      <Card className="flex flex-col gap-3">
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>DuckDB SQL</CardTitle>
            <CardDescription>
              Query the currently selected handle with <code className={inlineCodeClass}>vacp.data_sql</code>.
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <IconButton
              icon={<Play className="h-4 w-4 text-slate-100/90" />}
              label="Run query"
              title="Run the SQL query against this handle."
              variant="primary"
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => void run()}
            />
            <IconButton
              icon={<RefreshCw className="h-4 w-4 text-slate-100/90" />}
              label="Refresh snapshots"
              title="Ask the provider to refresh its state snapshot."
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => void refresh()}
            />
            <IconButton
              icon={<ClipboardCopy className="h-4 w-4 text-slate-100/90" />}
              label="Copy SQL"
              title="Copy the current SQL to clipboard."
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => void copy(selectedSql)}
            />
          </div>
        </CardHeader>

        <div className="grid gap-3 md:grid-cols-[1fr_220px]">
          <div>
            <label className="text-[11px] font-medium text-slate-100/70" htmlFor="vacp-sql">
              SQL
            </label>
            <Textarea
              id="vacp-sql"
              ref={editorRef}
              data-vacp-focus="data-sql"
              value={selectedSql}
              onChange={(e) => setSelectedSql(e.target.value)}
              className="mt-1 min-h-[160px] text-[12px] leading-5"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-slate-100/70" htmlFor="vacp-handle">
              Handle
            </label>
            <select id="vacp-handle" className={selectClass} value={selectedHandle ?? ''} onChange={(e) => setSelectedHandle(e.target.value as VacpRef)}>
              {handles.map((h) => (
                <option key={h.ref} value={h.ref}>
                  {h.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      <Card className="flex min-h-0 flex-col">
        <CardHeader>
          <div>
            <CardTitle>Result</CardTitle>
            <CardDescription>
              {selectedHandle ? (
                <>
                  Target:{' '}
                  <code className={inlineCodeClass}>{selectedHandleTitle ?? shortRef(selectedHandle)}</code>{' '}
                  <span className="text-slate-100/60">({shortRef(selectedHandle)})</span>
                </>
              ) : (
                'Select a DataHandle to query.'
              )}
            </CardDescription>
          </div>
        </CardHeader>
        <div className="min-h-0 flex-1 p-3">{resultView}</div>
      </Card>
    </div>
  );
}
