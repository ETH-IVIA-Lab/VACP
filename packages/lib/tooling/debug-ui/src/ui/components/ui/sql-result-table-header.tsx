import type { ReactElement } from 'react';

import type { Table } from '@tanstack/react-table';

import { cn } from '@vacp/debug-ui/ui/lib/utils';
import type { SqlResultColumn } from '@vacp/debug-ui/ui/sql/types';
import { ColumnTypeIcon } from './column-type-icon';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

type Row = Record<string, unknown>;

export function SqlResultTableHeader({
  table,
  columns,
}: {
  table: Table<Row>;
  columns: SqlResultColumn[];
}): ReactElement {
  const headers = table.getFlatHeaders();
  const { columnSizingInfo } = table.getState();

  return (
    <div className="sticky top-0 z-10 rounded-t-lg bg-[#0b1115]/88 backdrop-blur">
      <div className="flex border-b border-white/[0.07]" role="row">
        {headers.map((header, index) => {
          const isLast = index === headers.length - 1;
          const headStyles = { width: `calc(var(--header-${header.index}-size) * 1px)` };
          const isIndex = header.id === '__row';
          const colMeta = !isIndex ? (columns.find((c) => c.name === header.id) ?? null) : null;

          const tooltip =
            !isIndex && colMeta ? (
              <div className="flex flex-col gap-0.5">
                <div className="font-medium text-slate-50">{colMeta.name}</div>
                <div className="text-slate-100/70">{colMeta.databaseType}</div>
              </div>
            ) : null;

          return (
            <div
              key={header.id}
              role="columnheader"
              className={cn(
                'relative flex h-[34px] items-center gap-2 px-2 text-[11px] font-semibold text-slate-100/80 select-none',
                !isLast && 'border-r border-white/[0.055]',
                isIndex ? 'justify-end tabular-nums text-slate-100/60' : 'justify-start',
              )}
              style={headStyles}
            >
              {isIndex ? (
                <div className="ml-auto min-w-0 truncate">{String(header.column.columnDef.header ?? '')}</div>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex min-w-0 flex-1 cursor-default items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        {colMeta ? <ColumnTypeIcon type={colMeta.sqlType} className="text-slate-100/65" /> : null}
                        <div className="min-w-0 truncate">{String(header.column.columnDef.header ?? '')}</div>
                      </div>
                      {colMeta ? (
                        <span className="shrink-0 max-w-[140px] truncate text-[10px] uppercase tracking-wide text-slate-100/45">
                          {colMeta.databaseType}
                        </span>
                      ) : null}
                    </div>
                  </TooltipTrigger>
                  {tooltip ? (
                    <TooltipContent side="top" align="start" className="max-w-[520px]">
                      {tooltip}
                    </TooltipContent>
                  ) : null}
                </Tooltip>
              )}

              {header.column.getCanResize() && !isIndex ? (
                <div
                  className={cn(
                    'absolute right-0 top-0 h-full w-[6px] cursor-col-resize',
                    'after:absolute after:right-[2px] after:top-0 after:h-full after:w-[1px] after:bg-white/[0.08]',
                    columnSizingInfo.isResizingColumn === header.id && 'after:bg-slate-100/42',
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
  );
}
