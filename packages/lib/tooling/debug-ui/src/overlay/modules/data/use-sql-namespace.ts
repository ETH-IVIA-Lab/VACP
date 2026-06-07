import type { SQLNamespace } from '@codemirror/lang-sql';
import type { VacpActionCall, VacpRef } from '@vacp/core';
import { useEffect, useMemo, useRef, useState } from 'react';

import { VACP_DATA_SQL_ACTION } from '@vacp/core';

import type { VacpWindowBridge } from '@vacp/debug-ui/types';

function buildSqlSchemaNamespace(columns: { vacp_handle: string[]; vacp_all: string[] }): SQLNamespace {
  const table = (name: string) => ({ label: name, type: 'table' as const, boost: 99 });
  const col = (name: string) => ({ label: name, type: 'column' as const, boost: 1 });
  return {
    vacp_handle: { self: table('vacp_handle'), children: columns.vacp_handle.map(col) },
    vacp_all: { self: table('vacp_all'), children: columns.vacp_all.map(col) },
  };
}

function isJsonSchemaResult(value: unknown): value is { format: 'json'; columns: string[] } {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.format === 'json' && Array.isArray(v.columns);
}

export function useSqlNamespace(args: {
  bridge: VacpWindowBridge;
  selectedHandle: VacpRef | null;
  runtimeMode: 'live' | 'inspect';
  resetKey: string;
}): SQLNamespace {
  const { bridge, selectedHandle, runtimeMode, resetKey } = args;
  const cacheRef = useRef(new Map<string, { vacp_handle: string[]; vacp_all: string[] }>());
  const [schemaColumns, setSchemaColumns] = useState<{ vacp_handle: string[]; vacp_all: string[] }>({
    vacp_handle: [],
    vacp_all: [],
  });

  useEffect(() => {
    cacheRef.current.clear();
    setSchemaColumns({ vacp_handle: [], vacp_all: [] });
  }, [resetKey]);

  useEffect(() => {
    if (!selectedHandle) return;
    if (runtimeMode === 'inspect') {
      setSchemaColumns({ vacp_handle: [], vacp_all: [] });
      return;
    }

    const cached = cacheRef.current.get(selectedHandle);
    if (cached) {
      setSchemaColumns(cached);
      return;
    }

    let cancelled = false;
    const exec = async (sql: string) => {
      const call: VacpActionCall = {
        callId: crypto.randomUUID(),
        name: VACP_DATA_SQL_ACTION,
        params: { handleRef: selectedHandle, sql, format: 'json', maxRows: 0 },
      };
      const res =
        typeof bridge.dispatch === 'function'
          ? await bridge.dispatch(call, { source: 'debug', message: 'schema' })
          : await bridge.execute(call);
      if (!res.ok) throw new Error(res.error?.message ?? 'Schema query failed');
      return res.result as unknown;
    };

    void (async () => {
      try {
        const [handleRes, allRes] = await Promise.all([
          exec('SELECT * FROM vacp_handle LIMIT 0'),
          exec('SELECT * FROM vacp_all LIMIT 0'),
        ]);
        if (cancelled) return;
        const handleCols = isJsonSchemaResult(handleRes) ? handleRes.columns : [];
        const allCols = isJsonSchemaResult(allRes) ? allRes.columns : [];
        const next = { vacp_handle: handleCols, vacp_all: allCols };
        cacheRef.current.set(selectedHandle, next);
        setSchemaColumns(next);
      } catch {
        if (!cancelled) setSchemaColumns({ vacp_handle: [], vacp_all: [] });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bridge, runtimeMode, selectedHandle]);

  return useMemo(() => buildSqlSchemaNamespace(schemaColumns), [schemaColumns]);
}
