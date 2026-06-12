import type { ReactElement } from 'react';
import { useMemo } from 'react';

import JsonView from '@uiw/react-json-view';

import {
  collapseDepthForExpandDepth,
  jsonViewTheme,
  normalizeJsonViewerData,
} from '@vacp/debug-ui/ui/components/ui/json-theme';
import { cn } from '@vacp/debug-ui/ui/lib/utils';

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
  const collapsed = useMemo(() => collapseDepthForExpandDepth(expandDepth), [expandDepth]);

  return (
    <div
      className={cn(
        'min-h-0 w-full rounded-lg border border-white/[0.075] bg-white/[0.022] p-3 text-[12px] leading-5 text-slate-100/85',
        scrollable
          ? 'vacp-json-viewer-scrollable overflow-auto'
          : 'vacp-json-viewer-inline overflow-visible overflow-x-hidden',
        className,
      )}
      data-vacp-json-viewer="1"
    >
      {value == null ? (
        <div className="text-slate-100/60">{emptyText}</div>
      ) : (
        <JsonView
          className="vacp-json-viewer-tree"
          value={data as object}
          style={jsonViewTheme}
          collapsed={collapsed}
          displayDataTypes={false}
          displayObjectSize={true}
          enableClipboard={false}
          highlightUpdates={false}
          indentWidth={12}
          shortenTextAfterLength={0}
        />
      )}
    </div>
  );
}
