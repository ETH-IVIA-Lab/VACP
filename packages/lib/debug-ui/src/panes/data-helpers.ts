import type { VacpActionCall, VacpActionResult, VacpDataSqlResult } from '@vacp/core';

import type { VacpWindowBridge } from '../types';

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function isDataSqlResult(value: unknown): value is VacpDataSqlResult {
  return !!value && typeof value === 'object' && (value as any).format !== undefined;
}

export async function runDataSql(
  bridge: VacpWindowBridge,
  args: { handleRef: string; sql: string; maxRows?: number },
): Promise<VacpActionResult> {
  const call: VacpActionCall = {
    callId: crypto.randomUUID(),
    name: 'vacp.data_sql',
    params: { handleRef: args.handleRef, sql: args.sql, format: 'json', maxRows: args.maxRows ?? 50 },
  };
  if (typeof (bridge as any).dispatch === 'function') {
    return await (bridge as any).dispatch(call, { source: 'debug', message: 'data sql' });
  }
  return await bridge.execute(call);
}

export function renderResultTable(container: HTMLElement, result: VacpDataSqlResult): void {
  container.textContent = '';
  if (result.format !== 'json') {
    container.textContent = `format=${result.format} (not rendered in debug UI)`;
    return;
  }

  const columns = result.columns ?? [];
  const rows = result.rows ?? [];
  const table = document.createElement('table');
  table.className = 'vacp-debug-ui-table';

  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  columns.forEach((c) => {
    const th = document.createElement('th');
    th.textContent = c;
    trh.append(th);
  });
  thead.append(trh);

  const tbody = document.createElement('tbody');
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    columns.forEach((c) => {
      const td = document.createElement('td');
      const v = (r as any)?.[c];
      td.textContent = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      tr.append(td);
    });
    tbody.append(tr);
  });

  table.append(thead, tbody);
  container.append(table);
}
