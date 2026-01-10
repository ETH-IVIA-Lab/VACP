import type { VacpActionCall, VacpRef } from '@vacp/core';
import { useCallback, useMemo, useState } from 'react';

import { VACP_DATA_SQL_ACTION } from '@vacp/core';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';

import type { VacpWindowBridge } from '@vacp/debug-ui/types';
import { decodeArrowIpcBase64ToTable, tableRowsFromArrow, tableSchemaFromArrow, toJsonSafe } from '@vacp/debug-ui/ui/sql/arrow';
import { normalizeSingleStatementSql } from '@vacp/debug-ui/ui/sql/sql';
import type { SqlResultTableModel } from '@vacp/debug-ui/ui/sql/types';

export type DataSqlStatus = 'idle' | 'running' | 'error';

export type DataSqlOk = {
  baseSql: string;
  resolvedSql: string;
  table: SqlResultTableModel; // `truncated` === `hasMore` (next page exists)
  rawJsonSafe: unknown;
};

const DEFAULT_PAGE_SIZE = 200;
const RAW_JSON_PREVIEW_ROWS = 25;

function isArrowResult(value: unknown): value is { format: 'arrow_ipc_base64'; resolvedSql: string; arrowIpcBase64: string } {
  if (!value || typeof value !== 'object') return false;
  const v = value as any;
  return v.format === 'arrow_ipc_base64' && typeof v.arrowIpcBase64 === 'string' && typeof v.resolvedSql === 'string';
}

type ActiveQuery = {
  runId: string;
  handleRef: VacpRef;
  baseSql: string;
};

type DataSqlPage = {
  resolvedSql: string;
  table: SqlResultTableModel;
  nextOffset: number;
};

async function fetchDataSqlPage(args: {
  bridge: VacpWindowBridge;
  handleRef: VacpRef;
  baseSql: string;
  offset: number;
  limit: number;
}): Promise<DataSqlPage> {
  const { bridge, handleRef, baseSql, offset, limit } = args;
  const wrapped = `WITH __vacp_q AS (${baseSql}) SELECT * FROM __vacp_q LIMIT ${limit + 1} OFFSET ${Math.max(0, Math.floor(offset))}`;
  const call: VacpActionCall = {
    callId: crypto.randomUUID(),
    name: VACP_DATA_SQL_ACTION,
    params: {
      handleRef,
      sql: wrapped,
      format: 'arrow_ipc_base64',
    },
  };

  const res =
    typeof bridge.dispatch === 'function' ? await bridge.dispatch(call, { source: 'debug' }) : await bridge.execute(call);
  if (!res.ok) throw new Error(res.error?.message ?? 'Query failed');

  const raw = res.result as unknown;
  if (!isArrowResult(raw)) throw new Error('Unexpected result format');

  const arrowTable = decodeArrowIpcBase64ToTable(raw.arrowIpcBase64);
  const columns = tableSchemaFromArrow(arrowTable);
  const table = tableRowsFromArrow(arrowTable, columns, limit);
  const nextOffset = offset + table.rows.length;
  return { resolvedSql: raw.resolvedSql, table, nextOffset };
}

export function useDataSql(args: {
  bridge: VacpWindowBridge;
  runtimeMode: 'live' | 'inspect';
  setModeToLive?: () => void;
  pageSize?: number;
}): {
  status: DataSqlStatus;
  error: string | null;
  result: DataSqlOk | null;
  run: (handleRef: VacpRef, sql: string) => Promise<void>;
  fetchMore: () => Promise<void>;
  loadingMore: boolean;
  reset: () => void;
} {
  const { bridge, runtimeMode, setModeToLive, pageSize = DEFAULT_PAGE_SIZE } = args;
  const queryClient = useQueryClient();
  const [active, setActive] = useState<ActiveQuery | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const pageLimit = useMemo(() => Math.max(1, Math.floor(pageSize)), [pageSize]);

  const queryKey = useMemo(() => {
    if (!active) return ['vacp', 'data_sql', 'inactive'] as const;
    return ['vacp', 'data_sql', active.runId, active.handleRef, active.baseSql, pageLimit] as const;
  }, [active, pageLimit]);

  const q = useInfiniteQuery({
    queryKey,
    enabled: Boolean(active) && !validationError,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      if (!active) throw new Error('Missing query');
      return await fetchDataSqlPage({
        bridge,
        handleRef: active.handleRef,
        baseSql: active.baseSql,
        offset: Number(pageParam) || 0,
        limit: pageLimit,
      });
    },
    getNextPageParam: (lastPage: DataSqlPage) => (lastPage.table.truncated ? lastPage.nextOffset : undefined),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  const result = useMemo<DataSqlOk | null>(() => {
    if (!active) return null;
    const pages = q.data?.pages ?? [];
    if (pages.length === 0) return null;

    const columns = pages[0]!.table.columns;
    const rows = pages.flatMap((p) => p.table.rows);
    const hasMore = pages[pages.length - 1]!.table.truncated;

    const resolvedSql = pages[pages.length - 1]!.resolvedSql;
    const rawPreview = rows.slice(0, RAW_JSON_PREVIEW_ROWS).map((r) => toJsonSafe(r) as Record<string, unknown>);
    const rawJsonSafe = {
      format: 'json',
      resolvedSql,
      columns: columns.map((c) => c.name),
      rowsPreview: rawPreview,
      loadedRows: rows.length,
      hasMore,
      pageSize: pageLimit,
      note: `Raw JSON is a preview only (first ${RAW_JSON_PREVIEW_ROWS} rows).`,
    };

    return {
      baseSql: active.baseSql,
      resolvedSql,
      table: { columns, rows, truncated: hasMore },
      rawJsonSafe,
    };
  }, [active, pageLimit, q.data?.pages]);

  const run = useCallback(
    async (handleRef: VacpRef, sql: string) => {
      if (runtimeMode === 'inspect') setModeToLive?.();
      setValidationError(null);

      let baseSql: string;
      try {
        baseSql = normalizeSingleStatementSql(sql);
      } catch (e) {
        setValidationError(e instanceof Error ? e.message : String(e));
        return;
      }

      const next: ActiveQuery = { runId: crypto.randomUUID(), handleRef, baseSql };
      setActive(next);

      try {
        await queryClient.fetchInfiniteQuery({
          queryKey: ['vacp', 'data_sql', next.runId, next.handleRef, next.baseSql, pageLimit],
          initialPageParam: 0,
          queryFn: async ({ pageParam }) =>
            await fetchDataSqlPage({
              bridge,
              handleRef: next.handleRef,
              baseSql: next.baseSql,
              offset: Number(pageParam) || 0,
              limit: pageLimit,
            }),
          getNextPageParam: (lastPage: DataSqlPage) => (lastPage.table.truncated ? lastPage.nextOffset : undefined),
          staleTime: Number.POSITIVE_INFINITY,
        });
      } catch {
        // Let react-query own the error state.
      }
    },
    [bridge, pageLimit, queryClient, runtimeMode, setModeToLive],
  );

  const fetchMore = useCallback(async () => {
    if (!result?.table.truncated) return;
    await q.fetchNextPage();
  }, [q, result?.table.truncated]);

  const reset = useCallback(() => {
    setActive(null);
    setValidationError(null);
    void queryClient.cancelQueries({ queryKey: ['vacp', 'data_sql'] });
  }, [queryClient]);

  const status: DataSqlStatus = validationError
    ? 'error'
    : q.isError
      ? 'error'
      : q.isPending && active
        ? 'running'
        : 'idle';

  const error = validationError ?? (q.error instanceof Error ? q.error.message : q.error ? String(q.error) : null);
  const loadingMore = q.isFetchingNextPage;

  return { status, error, result, run, fetchMore, loadingMore, reset };
}
