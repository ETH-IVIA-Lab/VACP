import type { VacpPlaybook } from '@vacp/core';

/**
 * Mosaic/vgplot provider (project concepts).
 *
 * vgplot is a semantic runtime (marks, selections, interactors, widgets).
 * The provider exposes that runtime as a stable, agent-friendly protocol:
 * - VACP graph (what exists)
 * - VACP state snapshots (what is active)
 * - semantic actions (what can be done)
 */

/**
 * Minimal structural types for vgplot Plot/Mark/Interactor objects.
 * This keeps `@vacp/mosaic` usable even if Mosaic types are not installed.
 */
export interface VgplotMarkLike {
  type?: string;
  index?: number;
  sourceTable?: () => string | null;
  channels?: Array<{ channel: string; as?: string; field?: unknown }>;
}

export interface VgplotInteractorLike {
  constructor: { name: string };
  value?: unknown;
  selection?: { value?: unknown; update?: (...args: unknown[]) => unknown };
  init?: (svg: SVGElement) => unknown | Promise<unknown>;
}

export interface VgplotPlotLike {
  element?: HTMLElement;
  marks: VgplotMarkLike[];
  interactors: VgplotInteractorLike[];
  legends?: Array<{ legend: unknown; include?: boolean } | unknown>;
  setAttribute?: (name: string, value: unknown, options?: { silent?: boolean }) => boolean;
  update?: (...args: unknown[]) => unknown;
  getAttribute?: (name: string) => unknown;
}

export interface InstallVacpOnVgplotOptions {
  appId: string;
  viewId: string;
  plotId: string;
  title?: string;
  description?: string;
  annotateHostElement?: boolean;
  globalKey?: string;
  demos?: VacpPlaybook[];
}

export interface InstallVacpOnVgplotDashboardOptions {
  appId: string;
  viewId: string;
  title?: string;
  description?: string;
  globalKey?: string;
  demos?: VacpPlaybook[];
  /**
   * Optional DuckDB client to back the standard `vacp.data_sql` action.
   *
   * If omitted, this provider will still expose selections/actions, but callers
   * won't be able to query selected rows via SQL.
   */
  duckdbClient?: import('@vacp/duckdb').VacpDuckDbClient;
}
