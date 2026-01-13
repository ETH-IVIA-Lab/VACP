import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';

import { cn } from '@/lib/utils';
import type { DatasetRow } from '@/datasets/registry';

type Row = DatasetRow;

function formatCellValue(value: unknown): { text: string; alignRight?: boolean; muted?: boolean } {
  if (value == null) return { text: 'null', muted: true };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { text: String(value), muted: true };
    const text = Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/\.?0+$/, '');
    return { text, alignRight: true };
  }
  if (typeof value === 'boolean') return { text: value ? 'true' : 'false' };
  if (typeof value === 'string') return { text: value };
  try {
    return { text: JSON.stringify(value) };
  } catch {
    return { text: String(value) };
  }
}

function estimateHeaderPx(columnName: string): number {
  const padX = 16;
  const nameChars = columnName.length > 50 ? 18 : columnName.length;
  const namePx = nameChars * 7.25;
  return Math.ceil(padX + namePx);
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

function highlightClassForColumn(
  col: string,
  keys: { xKey: string; yKey: string; colorKey: string | null },
  isHeader: boolean,
): string {
  const { xKey, yKey, colorKey } = keys;
  if (col === xKey)
    return isHeader ? 'bg-[hsl(var(--dim-x)/0.18)] text-[hsl(var(--dim-x))]' : 'bg-[hsl(var(--dim-x)/0.08)]';
  if (col === yKey)
    return isHeader ? 'bg-[hsl(var(--dim-y)/0.18)] text-[hsl(var(--dim-y))]' : 'bg-[hsl(var(--dim-y)/0.08)]';
  if (colorKey && col === colorKey)
    return isHeader
      ? 'bg-[hsl(var(--dim-color)/0.18)] text-[hsl(var(--dim-color))]'
      : 'bg-[hsl(var(--dim-color)/0.08)]';
  return '';
}

export function DataTable({
  columns,
  rows,
  selectedIds,
  encoding,
  height = '460px',
  rowHeight = 30,
  headerHeight = 34,
}: {
  columns: string[];
  rows: Row[];
  selectedIds: string[];
  encoding: { x: string; y: string; color: string | null };
  height?: string;
  rowHeight?: number;
  headerHeight?: number;
}): ReactNode {
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
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
        const headerSize = estimateHeaderPx(c);
        const size = Math.max(estimateValuePx(c, rows), headerSize);
        const minSize = Math.max(120, Math.min(520, headerSize));
        return {
          id: c,
          header: c,
          accessorFn: (row) => row[c],
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
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro?.disconnect();
    };
  }, []);

  const totalRows = table.getRowModel().rows.length;
  const effectiveScrollTop = Math.max(0, scrollTop - headerHeight);
  const effectiveViewportHeight = Math.max(0, viewportHeight - headerHeight);
  const overscan = 10;
  const startIndex = Math.max(0, Math.floor(effectiveScrollTop / rowHeight) - overscan);
  const endIndex = Math.min(
    totalRows,
    Math.ceil((effectiveScrollTop + effectiveViewportHeight) / rowHeight) + overscan,
  );

  const headers = table.getFlatHeaders();
  const highlightKeys = { xKey: encoding.x, yKey: encoding.y, colorKey: encoding.color };

  return (
    <div className={cn('w-full min-w-0 rounded-lg border bg-background overflow-hidden')} style={{ height }}>
      <div ref={scrollRef} className="h-full w-full overflow-auto">
        <div
          className="min-w-full"
          style={{
            ...(columnSizeVars as any),
            minWidth: '100%',
            width: table.getTotalSize(),
          }}
        >
          <div className="sticky top-0 z-10 bg-background/80 backdrop-blur">
            <div className="flex border-b">
              {headers.map((header, index) => {
                const isLast = index === headers.length - 1;
                const headStyles = { width: `calc(var(--header-${header.index}-size) * 1px)` };
                const isIndex = header.id === '__row';
                const highlight = !isIndex ? highlightClassForColumn(header.id, highlightKeys, true) : '';
                return (
                  <div
                    key={header.id}
                    className={cn(
                      'relative flex h-[34px] items-center px-2 text-[11px] font-semibold text-foreground/80 select-none',
                      !isLast && 'border-r',
                      isIndex ? 'justify-end tabular-nums text-foreground/60' : 'justify-start',
                      highlight,
                    )}
                    style={headStyles}
                    title={String(header.column.columnDef.header ?? '')}
                  >
                    <div className="min-w-0 truncate">{String(header.column.columnDef.header ?? '')}</div>

                    {header.column.getCanResize() && !isIndex ? (
                      <div
                        className={cn(
                          'absolute right-0 top-0 h-full w-[6px] cursor-col-resize',
                          'after:absolute after:right-[2px] after:top-0 after:h-full after:w-[1px] after:bg-border',
                          columnSizingInfo.isResizingColumn === header.id && 'after:bg-foreground/50',
                        )}
                        onDoubleClick={() => header.column.resetSize()}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          header.getResizeHandler()(e);
                        }}
                        onTouchStart={header.getResizeHandler()}
                        style={{
                          transform:
                            columnSizingInfo.isResizingColumn === header.id
                              ? `translateX(${columnSizingInfo.deltaOffset}px)`
                              : '',
                        }}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          {totalRows === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">No rows.</div>
          ) : (
            <div className="relative" style={{ height: totalRows * rowHeight }}>
              {table
                .getRowModel()
                .rows.slice(startIndex, endIndex)
                .map((row) => {
                  const top = row.index * rowHeight;
                  const isSelected = selectedSet.has(String(row.original.id));
                  return (
                    <div
                      key={row.id}
                      className={cn(
                        'absolute left-0 right-0 flex border-b',
                        row.index % 2 === 1 && 'bg-muted/20',
                        isSelected && 'bg-accent/35',
                      )}
                      style={{ top, height: rowHeight }}
                    >
                      {row.getVisibleCells().map((cell, index) => {
                        const colIndex = cell.column.getIndex();
                        const isIndex = cell.column.id === '__row';
                        const highlight = !isIndex ? highlightClassForColumn(cell.column.id, highlightKeys, false) : '';
                        const value = cell.getValue();
                        const f = isIndex
                          ? { text: String(row.index + 1), alignRight: true, muted: true }
                          : formatCellValue(value);
                        const text = f.text;

                        return (
                          <div
                            key={cell.id}
                            className={cn(
                              'h-[30px] px-2 py-1 text-[12px] text-foreground/85',
                              index !== row.getVisibleCells().length - 1 && 'border-r border-border/70',
                              isIndex && 'text-right tabular-nums text-foreground/55',
                              f.alignRight && 'text-right tabular-nums',
                              f.muted && 'italic text-foreground/55',
                              highlight,
                            )}
                            style={{ width: `calc(var(--col-${colIndex}-size) * 1px)` }}
                            title={text}
                            onDoubleClick={() => void navigator.clipboard?.writeText(text)}
                          >
                            <div className="truncate">{text}</div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
