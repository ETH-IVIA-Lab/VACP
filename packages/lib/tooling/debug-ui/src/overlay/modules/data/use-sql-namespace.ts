import type { SQLNamespace } from '@codemirror/lang-sql';
import type { VacpActionCall, VacpRef } from '@vacp/core';
import { useEffect, useMemo, useRef, useState } from 'react';

import { VACP_DATA_SQL_ACTION } from '@vacp/core';

import type { VacpWindowBridge } from '@vacp/debug-ui/types';

import { executeDebugAction } from '../action-execution';

function emptySqlColumns(): { vacp_handle: string[]; vacp_all: string[] } {
  return { vacp_handle: [], vacp_all: [] };
}

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
  const [schemaColumns, setSchemaColumns] = useState<{ vacp_handle: string[]; vacp_all: string[] }>(emptySqlColumns);

  useEffect(() => {
    cacheRef.current.clear();
    setSchemaColumns(emptySqlColumns());
  }, [resetKey]);

  useEffect(() => {
    if (!selectedHandle) {
      setSchemaColumns(emptySqlColumns());
      return;
    }
    if (runtimeMode === 'inspect') {
      setSchemaColumns(emptySqlColumns());
      return;
    }

    const cacheKey = `${resetKey}:${selectedHandle}`;
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setSchemaColumns(cached);
      return;
    }

    setSchemaColumns(emptySqlColumns());

    let cancelled = false;
    const exec = async (sql: string) => {
      const call: VacpActionCall = {
        callId: crypto.randomUUID(),
        name: VACP_DATA_SQL_ACTION,
        params: { handleRef: selectedHandle, sql, format: 'json', maxRows: 0 },
      };
      const res = await executeDebugAction(bridge, call, { source: 'debug', message: 'schema' });
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
        cacheRef.current.set(cacheKey, next);
        setSchemaColumns(next);
      } catch {
        if (!cancelled) setSchemaColumns(emptySqlColumns());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bridge, resetKey, runtimeMode, selectedHandle]);

  return useMemo(() => buildSqlSchemaNamespace(schemaColumns), [schemaColumns]);
}
