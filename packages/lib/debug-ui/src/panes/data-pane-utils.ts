import type { VacpActionResult } from '@vacp/core';

import type { VacpWindowBridge } from '../types';
import { isDataSqlResult, runDataSql, safeJson } from './data-helpers';

export async function copyToClipboard(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ignore
  }
}

export async function buildSelectionPreview(
  bridge: VacpWindowBridge,
  args: { handleRef: string },
): Promise<{ at: string; text: string }> {
  const now = new Date().toISOString();
  const lines: string[] = [];
  lines.push(`handle: ${args.handleRef}`);
  lines.push(`at: ${now}`);

  const resAll = await runDataSql(bridge, {
    handleRef: args.handleRef,
    sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_all',
  });
  const resSel = await runDataSql(bridge, {
    handleRef: args.handleRef,
    sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_handle',
  });

  const fmt = (r: VacpActionResult) => {
    if (!r.ok) return `error: ${(r as any)?.error?.message ?? 'unknown error'}`;
    const rr = r.result;
    if (isDataSqlResult(rr) && rr.format === 'json') return safeJson(rr.rows?.[0] ?? {});
    return safeJson(rr);
  };
  lines.push(`vacp_all: ${fmt(resAll)}`);
  lines.push(`vacp_handle: ${fmt(resSel)}`);

  return { at: now, text: lines.join('\n') };
}

