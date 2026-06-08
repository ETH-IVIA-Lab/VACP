import type { CSSProperties } from 'react';

export type JsonViewTheme = CSSProperties & Record<`--${string}`, string | number>;

export const jsonViewTheme: JsonViewTheme = {
  '--w-rjv-font-family':
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  '--w-rjv-color': 'rgba(226, 232, 240, 0.78)',
  '--w-rjv-key-string': '#93c5fd',
  '--w-rjv-background-color': 'transparent',
  '--w-rjv-line-color': 'rgba(148, 163, 184, 0.16)',
  '--w-rjv-arrow-color': 'rgba(203, 213, 225, 0.72)',
  '--w-rjv-edit-color': 'rgba(226, 232, 240, 0.76)',
  '--w-rjv-info-color': 'rgba(148, 163, 184, 0.56)',
  '--w-rjv-update-color': 'rgba(125, 211, 252, 0.16)',
  '--w-rjv-copied-color': 'rgba(203, 213, 225, 0.7)',
  '--w-rjv-copied-success-color': '#86efac',
  '--w-rjv-curlybraces-color': 'rgba(226, 232, 240, 0.64)',
  '--w-rjv-colon-color': 'rgba(148, 163, 184, 0.72)',
  '--w-rjv-brackets-color': 'rgba(226, 232, 240, 0.64)',
  '--w-rjv-quotes-color': 'rgba(148, 163, 184, 0.64)',
  '--w-rjv-quotes-string-color': 'rgba(148, 163, 184, 0.64)',
  '--w-rjv-type-string-color': '#86efac',
  '--w-rjv-type-int-color': '#fbbf24',
  '--w-rjv-type-float-color': '#fbbf24',
  '--w-rjv-type-bigint-color': '#fbbf24',
  '--w-rjv-type-boolean-color': '#c4b5fd',
  '--w-rjv-type-date-color': '#67e8f9',
  '--w-rjv-type-url-color': '#7dd3fc',
  '--w-rjv-type-null-color': '#fda4af',
  '--w-rjv-type-nan-color': '#fda4af',
  '--w-rjv-type-undefined-color': '#fda4af',
  backgroundColor: 'transparent',
  color: 'rgba(226, 232, 240, 0.78)',
  fontSize: 12,
  lineHeight: 1.55,
};

export function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function normalizeJsonViewerData(value: unknown): Record<string, unknown> | unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  return [value];
}

export function collapseDepthForExpandDepth(expandDepth: number): boolean | number {
  if (!Number.isFinite(expandDepth)) return 2;
  const depth = Math.floor(expandDepth);
  if (depth <= 0) return true;
  return depth;
}
