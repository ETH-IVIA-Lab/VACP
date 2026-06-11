import type { SQLNamespace } from '@codemirror/lang-sql';
import type { VacpActionCall, VacpDataSchemaColumn, VacpDataSchemaResult, VacpRef } from '@vacp/core';
import { useEffect, useMemo, useRef, useState } from 'react';

import { VACP_DATA_SCHEMA_ACTION, VACP_DATA_SQL_ACTION } from '@vacp/core';

import type { VacpWindowBridge } from '@vacp/debug-ui/types';

import { executeDebugAction } from '../action-execution';

export type DebugSqlColumn = Pick<VacpDataSchemaColumn, 'name' | 'type' | 'notNull' | 'primaryKey'>;

export type DebugSqlSchema = {
  vacp_handle: DebugSqlColumn[];
  vacp_all: DebugSqlColumn[];
  rowCount: number | null;
  source: 'none' | 'data_schema' | 'data_sql';
};

function emptySqlSchema(): DebugSqlSchema {
  return { vacp_handle: [], vacp_all: [], rowCount: null, source: 'none' };
}

function columnsFromNames(names: string[]): DebugSqlColumn[] {
  return names.map((name) => ({ name, type: 'UNKNOWN' }));
}

function columnNames(columns: DebugSqlColumn[]): string[] {
  return columns.map((c) => c.name).filter(Boolean);
}

function buildSqlSchemaNamespace(columns: DebugSqlSchema): SQLNamespace {
  const table = (name: string) => ({ label: name, type: 'table' as const, boost: 99 });
  const col = (name: string) => ({ label: name, type: 'column' as const, boost: 1 });
  return {
    vacp_handle: { self: table('vacp_handle'), children: columnNames(columns.vacp_handle).map(col) },
    vacp_all: { self: table('vacp_all'), children: columnNames(columns.vacp_all).map(col) },
  };
}

function isJsonSchemaResult(value: unknown): value is { format: 'json'; columns: string[] } {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.format === 'json' && Array.isArray(v.columns);
}

function isDataSchemaResult(value: unknown): value is VacpDataSchemaResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<VacpDataSchemaResult>;
  return Array.isArray(v.columns);
}

export function useSqlSchema(args: {
  bridge: VacpWindowBridge;
  selectedHandle: VacpRef | null;
  runtimeMode: 'live' | 'inspect';
  resetKey: string;
}): { namespace: SQLNamespace; schema: DebugSqlSchema } {
  const { bridge, selectedHandle, runtimeMode, resetKey } = args;
  const cacheRef = useRef(new Map<string, DebugSqlSchema>());
  const [schemaColumns, setSchemaColumns] = useState<DebugSqlSchema>(emptySqlSchema);

  useEffect(() => {
    cacheRef.current.clear();
    setSchemaColumns(emptySqlSchema());
  }, [resetKey]);

  useEffect(() => {
    if (!selectedHandle) {
      setSchemaColumns(emptySqlSchema());
      return;
    }
    if (runtimeMode === 'inspect') {
      setSchemaColumns(emptySqlSchema());
      return;
    }

    const cacheKey = `${resetKey}:${selectedHandle}`;
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setSchemaColumns(cached);
      return;
    }

    setSchemaColumns(emptySqlSchema());

    let cancelled = false;
    const execSchema = async () => {
      const call: VacpActionCall = {
        callId: crypto.randomUUID(),
        name: VACP_DATA_SCHEMA_ACTION,
        params: { handleRef: selectedHandle, detail: 'columns' },
      };
      const res = await executeDebugAction(bridge, call, { source: 'debug', message: 'schema' });
      if (!res.ok) throw new Error(res.error?.message ?? 'Schema query failed');
      return res.result as unknown;
    };
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
        const schemaRes = await execSchema();
        if (cancelled) return;
        if (!isDataSchemaResult(schemaRes)) throw new Error('Unexpected schema result format');
        const columns = schemaRes.columns.filter((c) => typeof c.name === 'string' && c.name.length > 0);
        const next: DebugSqlSchema = {
          vacp_handle: columns,
          vacp_all: columns,
          rowCount: typeof schemaRes.rowCount === 'number' ? schemaRes.rowCount : null,
          source: 'data_schema',
        };
        cacheRef.current.set(cacheKey, next);
        setSchemaColumns(next);
      } catch {
        try {
          const [handleRes, allRes] = await Promise.all([
            exec('SELECT * FROM vacp_handle LIMIT 0'),
            exec('SELECT * FROM vacp_all LIMIT 0'),
          ]);
          if (cancelled) return;
          const handleCols = isJsonSchemaResult(handleRes) ? columnsFromNames(handleRes.columns) : [];
          const allCols = isJsonSchemaResult(allRes) ? columnsFromNames(allRes.columns) : [];
          const next: DebugSqlSchema = { vacp_handle: handleCols, vacp_all: allCols, rowCount: null, source: 'data_sql' };
          cacheRef.current.set(cacheKey, next);
          setSchemaColumns(next);
        } catch {
          if (!cancelled) setSchemaColumns(emptySqlSchema());
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bridge, resetKey, runtimeMode, selectedHandle]);

  const namespace = useMemo(() => buildSqlSchemaNamespace(schemaColumns), [schemaColumns]);
  return { namespace, schema: schemaColumns };
}

export function useSqlNamespace(args: {
  bridge: VacpWindowBridge;
  selectedHandle: VacpRef | null;
  runtimeMode: 'live' | 'inspect';
  resetKey: string;
}): SQLNamespace {
  return useSqlSchema(args).namespace;
}
