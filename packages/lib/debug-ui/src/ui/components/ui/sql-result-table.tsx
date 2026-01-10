import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';

import { cn } from '@vacp/debug-ui/ui/lib/utils';
import type { SqlResultColumn } from '@vacp/debug-ui/ui/sql/types';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';
import { SqlResultTableHeader } from './sql-result-table-header';

type Row = Record<string, unknown>;

function formatCellValue(value: unknown): { text: string; alignRight?: boolean; muted?: boolean } {
  if (value == null) return { text: 'null', muted: true };
  if (typeof value === 'number') return { text: String(value), alignRight: true };
  if (typeof value === 'boolean') return { text: value ? 'true' : 'false' };
  if (typeof value === 'string') return { text: value };
  try {
    return { text: JSON.stringify(value) };
  } catch {
    return { text: String(value) };
  }
}

function estimateHeaderPx(columnName: string, databaseType: string): number {
  const padX = 16; // px-2
  const leftIcon = 14;
  const leftGap = 8;
  const groupGap = 12;
  const nameChars = columnName.length > 50 ? 18 : columnName.length;
  const typeChars = Math.min(databaseType.length, 14);
  const namePx = nameChars * 7.25;
  const typePx = typeChars * 6.5 + 10;
  return Math.ceil(padX + leftIcon + leftGap + namePx + groupGap + typePx);
}

function estimateValuePx(columnName: string, rows: Row[], sampleSize = 25): number {
  const base = 120;
  const max = 520;
  const pad = 24;
  const charPx = 7.25;
  let maxLen = Math.min(columnName.length, 50);
  for (let i = 0; i < Math.min(sampleSize, rows.length); i += 1) {
    const v = rows[i]?.[columnName];
    const t = formatCellValue(v).text;
    maxLen = Math.max(maxLen, t.length);
  }
  return Math.max(base, Math.min(max, Math.ceil(maxLen * charPx + pad)));
}

export function SqlResultTable({
  columns,
  rows,
  height = '260px',
  onCopy,
  className,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  rowHeight = 30,
  headerHeight = 34,
}: {
  columns: SqlResultColumn[];
  rows: Row[];
  height?: string;
  onCopy?: (text: string) => void;
  className?: string;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  rowHeight?: number;
  headerHeight?: number;
}): ReactNode {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const tableColumns = useMemo<ColumnDef<Row, unknown>[]>(() => {
    const indexSize = 56;
    const defs: ColumnDef<Row, unknown>[] = [
      {
        id: '__row',
        header: '#',
        cell: (info) => info.row.index + 1,
        enableResizing: false,
        size: indexSize,
        minSize: indexSize,
        maxSize: indexSize,
      },
      ...columns.map((c) => {
        const headerSize = estimateHeaderPx(c.name, c.databaseType);
        const size = Math.max(estimateValuePx(c.name, rows), headerSize);
        const minSize = Math.max(120, Math.min(520, headerSize));
        return {
          id: c.name,
          header: c.name,
          accessorFn: (row) => row[c.name],
          size,
          minSize,
          maxSize: 520,
        } satisfies ColumnDef<Row, unknown>;
      }),
    ];
    return defs;
  }, [columns, rows]);

  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    columnResizeMode: 'onEnd',
    getCoreRowModel: getCoreRowModel(),
  });

  const { columnSizingInfo, columnSizing } = table.getState();

  const columnSizeVars = useMemo(() => {
    const headers = table.getFlatHeaders();
    const vars: Record<string, number> = {};

    for (let i = 0; i < headers.length; i += 1) {
      const header = headers[i]!;
      vars[`--header-${header.index}-size`] = header.getSize();
      vars[`--col-${header.index}-size`] = header.column.getSize();
    }

    const sizingKeys = Object.keys(columnSizing);
    for (let i = 0; i < sizingKeys.length; i += 1) {
      const key = sizingKeys[i]!;
      if (!(key in vars)) {
        const existingSize = columnSizing[key];
        if (typeof existingSize === 'number') vars[`--col-${key}-size`] = existingSize;
      }
    }

    if (columnSizingInfo.isResizingColumn !== null) {
      // Access resizing state so memo updates when the active resize target changes.
    }

    return vars;
  }, [columnSizing, columnSizingInfo.isResizingColumn, table]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const updateViewport = () => setViewportHeight(el.clientHeight);
    updateViewport();

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateViewport) : null;
    ro?.observe(el);

    const onScroll = () => {
      setScrollTop(el.scrollTop);
      setViewportHeight(el.clientHeight);
      if (!onLoadMore || !hasMore || loadingMore) return;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - rowHeight * 2;
      if (atBottom) onLoadMore();
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro?.disconnect();
    };
  }, [hasMore, loadingMore, onLoadMore, rowHeight]);

  const totalRows = rows.length + (hasMore ? 1 : 0);
  const effectiveScrollTop = Math.max(0, scrollTop - headerHeight);
  const effectiveViewportHeight = Math.max(0, viewportHeight - headerHeight);
  const overscan = 10;
  const startIndex = Math.max(0, Math.floor(effectiveScrollTop / rowHeight) - overscan);
  const endIndex = Math.min(totalRows, Math.ceil((effectiveScrollTop + effectiveViewportHeight) / rowHeight) + overscan);

  return (
    <div
      className={cn('w-full min-w-0 rounded-lg border border-white/10 bg-white/5 overflow-hidden', className)}
      style={{ height, maxHeight: height }}
    >
      <div ref={scrollRef} className="h-full w-full overflow-auto">
        <div
          className="min-w-full"
          style={{
            ...(columnSizeVars as any),
            minWidth: '100%',
            width: table.getTotalSize(),
          }}
        >
          <SqlResultTableHeader table={table} columns={columns} />

          {table.getRowModel().rows.length === 0 ? (
            <div className="px-3 py-4 text-[12px] text-slate-100/70">No results.</div>
          ) : (
            <div className="relative" style={{ height: totalRows * rowHeight }}>
              {table
                .getRowModel()
                .rows.slice(startIndex, Math.min(endIndex, rows.length))
                .map((row) => {
                  const absoluteIndex = row.index;
                  const top = absoluteIndex * rowHeight;
                  return (
                    <div
                      key={row.id}
                      className={cn('absolute left-0 right-0 flex border-b border-white/10', absoluteIndex % 2 === 1 && 'bg-white/[0.02]')}
                      style={{ top }}
                    >
                      {row.getVisibleCells().map((cell, index) => {
                        const colIndex = cell.column.getIndex();
                        const isIndex = cell.column.id === '__row';
                        const value = cell.getValue();
                        const f = isIndex ? { text: String(row.index + 1), alignRight: true, muted: true } : formatCellValue(value);
                        const text = f.text;

                        const cellNode = (
                          <div
                            className={cn(
                              'h-[30px] px-2 py-1 text-[12px] text-slate-100/85',
                              index !== row.getVisibleCells().length - 1 && 'border-r border-white/5',
                              isIndex && 'text-right tabular-nums text-slate-100/55',
                              f.alignRight && 'text-right tabular-nums',
                              f.muted && 'italic text-slate-100/55',
                            )}
                            style={{ width: `calc(var(--col-${colIndex}-size) * 1px)` }}
                            onClick={(e) => {
                              if (!onCopy) return;
                              if (e.shiftKey) onCopy(text);
                            }}
                            onDoubleClick={() => onCopy?.(text)}
                          >
                            <div className="truncate">{text}</div>
                          </div>
                        );

                        const showTooltip = !isIndex && (text.length > 24 || text.includes('\n'));

                        return showTooltip ? (
                          <Tooltip key={cell.id}>
                            <TooltipTrigger asChild>{cellNode}</TooltipTrigger>
                            <TooltipContent side="top" align="start" className="max-w-[520px] whitespace-pre-wrap">
                              {text}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <div key={cell.id}>{cellNode}</div>
                        );
                      })}
                    </div>
                  );
                })}

              {hasMore && endIndex > rows.length ? (
                <div
                  className="absolute left-0 right-0 flex items-center px-3 text-[12px] text-slate-100/60"
                  style={{ top: rows.length * rowHeight, height: rowHeight }}
                >
                  {loadingMore ? 'Loading…' : 'Scroll to load more'}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
