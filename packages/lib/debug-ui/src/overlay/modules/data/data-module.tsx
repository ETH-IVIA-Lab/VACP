import type { VacpNode, VacpRef } from '@vacp/core';
import { ClipboardCopy, Play, RefreshCw } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { IconButton } from '@vacp/debug-ui/overlay/icon-button';
import { useVacpDebugUiStore } from '@vacp/debug-ui/overlay/debug-store';
import { useElementSize } from '@vacp/debug-ui/overlay/hooks/use-element-size';
import { Card, CardDescription, CardHeader, CardTitle } from '@vacp/debug-ui/ui/components/ui/card';
import { JsonViewer } from '@vacp/debug-ui/ui/components/ui/json-viewer';
import { SqlEditor } from '@vacp/debug-ui/ui/components/ui/sql-editor';
import { SqlResultTable } from '@vacp/debug-ui/ui/components/ui/sql-result-table';
import { copyTextToClipboard } from '@vacp/debug-ui/ui/lib/clipboard';
import { cn } from '@vacp/debug-ui/ui/lib/utils';
import type { VacpDebugModuleProps } from '../module-types';
import { defaultQuery, shortRef } from './data-utils';
import { useDataSql } from './use-data-sql';
import { useSqlNamespace } from './use-sql-namespace';

export function DataModule(props: VacpDebugModuleProps): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rootSize = useElementSize(rootRef);
  const compactControls = rootSize.width < 520;
  const dense = rootSize.width < 520 || rootSize.height < 360;
  const iconButtonSize = 'iconSm';
  const tableRowHeight = 30;
  const tableHeaderHeight = 34;
  const tableHeight = `${tableHeaderHeight + 10 * tableRowHeight}px`;

  const inlineCodeClass =
    'rounded-md border border-white/10 bg-slate-900/70 px-1.5 py-0.5 text-[11px] font-medium text-slate-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)]';
  const selectClass =
    'mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-2 text-xs text-slate-100 outline-none focus:ring-2 focus:ring-sky-400/40';

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

  const handleRefs = useMemo(() => handles.map((h) => h.ref), [handles]);
  const graphSignature = useMemo(() => handleRefs.map(String).sort().join('|'), [handleRefs]);

  const selectedHandle = useVacpDebugUiStore((s) => s.dataSelectedHandleRef);
  const sqlByHandle = useVacpDebugUiStore((s) => s.dataSqlByHandleRef);
  const setSelectedHandle = useVacpDebugUiStore((s) => s.setDataSelectedHandleRef);
  const setSqlForHandle = useVacpDebugUiStore((s) => s.setDataSqlForHandle);
  const graphSig = useVacpDebugUiStore((s) => s.dataGraphSignature);
  const setGraphSig = useVacpDebugUiStore((s) => s.setDataGraphSignature);
  const resetDataModule = useVacpDebugUiStore((s) => s.resetDataModule);

  const [schemaResetId, setSchemaResetId] = useState(0);

  useEffect(() => {
    if (graphSignature && graphSig === graphSignature) return;
    resetDataModule();
    setSchemaResetId((x) => x + 1);
    if (graphSignature) setGraphSig(graphSignature);
  }, [graphSig, graphSignature, resetDataModule, setGraphSig]);

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
  const setSelectedSql = (sql: string) => {
    if (!selectedHandle) return;
    setSqlForHandle(selectedHandle, sql);
  };

  const sqlSchema = useSqlNamespace({
    bridge: props.bridge,
    selectedHandle,
    runtimeMode: props.runtime.mode,
    resetKey: `${graphSignature}:${schemaResetId}`,
  });

  const dataSql = useDataSql({
    bridge: props.bridge,
    runtimeMode: props.runtime.mode,
    setModeToLive: () => props.bridge.setMode?.('live', { source: 'debug', message: 'auto: back to live for query' }),
  });

  const editorRef = useRef<import('@uiw/react-codemirror').ReactCodeMirrorRef | null>(null);

  useEffect(() => {
    dataSql.reset();
  }, [dataSql.reset, graphSignature, props.runtime.runtimeId]);

  const refresh = async () => {
    if (typeof props.bridge.refresh !== 'function') return;
    await props.bridge.refresh({ source: 'debug', message: 'refresh' });
    setSchemaResetId((x) => x + 1);
  };

  const run = async () => {
    if (!selectedHandle) return;
    await dataSql.run(selectedHandle, selectedSql);
    requestAnimationFrame(() => editorRef.current?.view?.focus());
  };

  const resultView = (() => {
    if (dataSql.status === 'running') return <div className="text-[12px] text-slate-100/80">Running…</div>;
    if (dataSql.status === 'error') return <div className="text-[12px] text-rose-100/80">{dataSql.error ?? 'Query failed'}</div>;
    if (!dataSql.result) return <div className="text-[12px] text-slate-100/80">Run a query to see results.</div>;

    const { table, rawJsonSafe, resolvedSql } = dataSql.result;
    const hasMore = table.truncated;

    return (
      <>
        <div className="text-[12px] text-slate-100/80">
          Query relations: <code className={inlineCodeClass}>vacp_handle</code> (current selection) and{' '}
          <code className={inlineCodeClass}>vacp_all</code> (full dataset).
        </div>

        <SqlResultTable
          columns={table.columns}
          rows={table.rows}
          height={tableHeight}
          onCopy={(t) => void copyTextToClipboard(t)}
          className="mt-2"
          hasMore={hasMore}
          loadingMore={dataSql.loadingMore}
          onLoadMore={() => void dataSql.fetchMore()}
          rowHeight={tableRowHeight}
          headerHeight={tableHeaderHeight}
        />

        <details className="mt-3 rounded-lg border border-white/10 bg-black/10 px-3 py-2">
          <summary className="cursor-pointer text-[12px] text-slate-100/80">Raw JSON</summary>
          <JsonViewer value={rawJsonSafe} className="mt-2 max-h-[320px]" />
        </details>

        <details className="mt-3 rounded-lg border border-white/10 bg-black/10 px-3 py-2">
          <summary className="cursor-pointer text-[12px] text-slate-100/80">Resolved SQL</summary>
          <div className="mt-2">
            <SqlEditor value={resolvedSql} readOnly autoFocus={false} height="140px" />
          </div>
        </details>
      </>
    );
  })();

  const selectedHandleTitle = useMemo(() => {
    if (!selectedHandle) return null;
    const found = handles.find((h) => h.ref === selectedHandle);
    return found?.title ?? null;
  }, [handles, selectedHandle]);

  return (
    <div ref={rootRef} className={cn('grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]', dense ? 'gap-2' : 'gap-3')}>
      <Card className={cn('flex flex-col', dense ? 'gap-2 p-2' : 'gap-3')}>
        <CardHeader className={cn(compactControls && 'flex-col items-stretch gap-2')}>
          <div className="min-w-0">
            <CardTitle>DuckDB SQL</CardTitle>
            <CardDescription>
              Query the currently selected handle with <code className={inlineCodeClass}>vacp.data_sql</code>.
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
              icon={<Play className="h-4 w-4 text-slate-100/90" />}
              label="Run query"
              title="Run the SQL query against this handle."
              variant="primary"
              size={iconButtonSize}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => void run()}
            />
            <IconButton
              icon={<RefreshCw className="h-4 w-4 text-slate-100/90" />}
              label="Refresh snapshots"
              title="Ask the provider to refresh its state snapshot."
              size={iconButtonSize}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => void refresh()}
            />
            <IconButton
              icon={<ClipboardCopy className="h-4 w-4 text-slate-100/90" />}
              label="Copy SQL"
              title="Copy the current SQL to clipboard."
              size={iconButtonSize}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => void copyTextToClipboard(selectedSql)}
            />
          </div>
        </CardHeader>

        <div className={cn('grid', dense ? 'gap-2' : 'gap-3')}>
          <div>
            <label className="text-[11px] font-medium text-slate-100/70" htmlFor="vacp-handle">
              Handle
            </label>
            <select
              id="vacp-handle"
              className={selectClass}
              value={selectedHandle ?? ''}
              onChange={(e) => setSelectedHandle(e.target.value as VacpRef)}
            >
              {handles.map((h) => (
                <option key={h.ref} value={h.ref}>
                  {h.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] font-medium text-slate-100/70" htmlFor="vacp-sql">
              SQL
            </label>
            <SqlEditor
              id="vacp-sql"
              ref={editorRef}
              data-vacp-focus="data-sql"
              value={selectedSql}
              onChange={(v) => setSelectedSql(v)}
              onRun={() => void run()}
              schema={sqlSchema}
              placeholder="DuckDB SQL (Mod+Enter to run, Ctrl/Cmd+Space to complete)"
              className="mt-1"
            />
            <div className="mt-1 text-[11px] text-slate-100/55">
              Tip: Shift+click or double-click a cell to copy it{props.runtime.mode === 'inspect' ? ' (autocomplete schema is live-mode only).' : '.'}
            </div>
          </div>
        </div>
      </Card>
      <Card className={cn('flex min-h-0 flex-col overflow-hidden', dense && 'p-2')}>
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
        <div className={cn('min-h-0 flex-1 overflow-auto', dense ? 'p-2' : 'p-3')}>{resultView}</div>
      </Card>
    </div>
  );
}
