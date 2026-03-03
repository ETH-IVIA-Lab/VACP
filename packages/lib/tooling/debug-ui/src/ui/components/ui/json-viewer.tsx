import type { ReactElement } from 'react';
import { useMemo } from 'react';

import { JsonView, darkStyles } from 'react-json-view-lite';

import { cn } from '@vacp/debug-ui/ui/lib/utils';

function normalizeJsonViewerData(value: unknown): Record<string, unknown> | unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  return [value];
}

export type JsonViewerProps = {
  value: unknown;
  className?: string;
  emptyText?: string;
  expandDepth?: number;
  scrollable?: boolean;
};

export function JsonViewer({
  value,
  className,
  emptyText = '',
  expandDepth = 2,
  scrollable = true,
}: JsonViewerProps): ReactElement {
  const data = useMemo(() => normalizeJsonViewerData(value), [value]);
  const shouldExpandNode = useMemo(() => (level: number) => level < expandDepth, [expandDepth]);
  const style = useMemo(() => ({ ...darkStyles, container: cn(darkStyles.container, 'vacp-json-viewer-tree') }), []);

  return (
    <div
      className={cn(
        'min-h-0 w-full rounded-lg border border-white/10 bg-black/20 p-3 text-[12px] leading-5 text-slate-100/85',
        scrollable ? 'overflow-auto' : 'overflow-visible overflow-x-hidden',
        className,
      )}
      data-vacp-json-viewer="1"
    >
      {value == null ? (
        <div className="text-slate-100/60">{emptyText}</div>
      ) : (
        <JsonView data={data} style={style} shouldExpandNode={shouldExpandNode} />
      )}
    </div>
  );
}
