import { useCallback, useEffect, useMemo, useRef } from 'react';
import { RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { listDatasets, type DatasetId, type Encoding } from '@/datasets/registry';
import { ScatterView } from '@/components/charts/scatter-view';
import { XBrushView } from '@/components/charts/x-brush-view';
import { applyBrush, getColumns, getNumericColumns, sortRowsByNumericKey, toFiniteNumber } from '@/lib/dashboard';
import { type BrushRange, useDashboardStore } from '@/state/dashboard-store';

type Props = {
  onInteraction?: (message: string) => void;
};

const datasetOptions = listDatasets();

export default function App({ onInteraction }: Props) {
  const { datasetId, dataset, encoding, selectedIds, brush, loading, error, actions } = useDashboardStore();

  const numericColumns = useMemo(() => (dataset ? getNumericColumns(dataset) : []), [dataset]);
  const allColumns = useMemo(() => (dataset ? getColumns(dataset) : []), [dataset]);
  const vacpDebugHref = useMemo(() => {
    if (typeof window === 'undefined') return '/?vacpDebug=1';
    const url = new URL(window.location.href);
    url.searchParams.set('vacpDebug', '1');
    return `${url.pathname}?${url.searchParams.toString()}`;
  }, []);

  useEffect(() => {
    if (!dataset) return;
    if (!numericColumns.length) return;

    const patch: Partial<Encoding> = {};
    if (!numericColumns.includes(encoding.x)) patch.x = numericColumns[0]!;
    if (!numericColumns.includes(encoding.y)) patch.y = numericColumns[1] ?? numericColumns[0]!;
    if (Object.keys(patch).length) actions.setEncoding(patch);
  }, [actions, dataset, encoding.x, encoding.y, numericColumns]);

  const sortedRows = useMemo(
    () => (dataset ? sortRowsByNumericKey(dataset.rows, encoding.x) : []),
    [dataset, encoding.x],
  );
  const brushedRows = useMemo(() => applyBrush(sortedRows, brush), [brush, sortedRows]);
  const brushedXRangeLabel = useMemo(() => {
    if (!brush) return null;
    const start = sortedRows[brush.startIndex];
    const end = sortedRows[brush.endIndex];
    const startX = start ? toFiniteNumber(start[encoding.x]) : null;
    const endX = end ? toFiniteNumber(end[encoding.x]) : null;
    if (startX === null || endX === null) return null;
    const a = Math.round(startX * 100) / 100;
    const b = Math.round(endX * 100) / 100;
    return a <= b ? `[${a}, ${b}]` : `[${b}, ${a}]`;
  }, [brush, encoding.x, sortedRows]);

  const onSetDataset = useCallback(
    (id: DatasetId) => {
      void actions
        .setDatasetId(id)
        .then(() => onInteraction?.(`set dataset: ${id}`))
        .catch(() => onInteraction?.(`set dataset failed: ${id}`));
    },
    [actions, onInteraction],
  );

  const onSetEncoding = useCallback(
    (patch: { x?: string; y?: string; color?: string | null }) => {
      actions.setEncoding(patch);
      onInteraction?.(`set encoding`);
    },
    [actions, onInteraction],
  );

  const onToggleSelectedId = useCallback(
    (id: string) => {
      actions.toggleSelectedId(id);
      onInteraction?.('toggle point selection');
    },
    [actions, onInteraction],
  );

  const onApplyLassoSelection = useCallback(
    (args: { polygon: Array<{ x: number; y: number }>; ids: string[] }) => {
      actions.applyLassoSelection(args.polygon, args.ids);
      onInteraction?.('lasso selection');
    },
    [actions, onInteraction],
  );

  const onClearSelection = useCallback(() => {
    actions.clearSelection();
    onInteraction?.('clear selection');
  }, [actions, onInteraction]);

  const onClearBrush = useCallback(() => {
    actions.clearBrush();
    onInteraction?.('clear brush');
  }, [actions, onInteraction]);

  const onResetBrushAndSelection = useCallback(() => {
    actions.clearBrush();
    actions.clearSelection();
    onInteraction?.('reset brush + selection');
  }, [actions, onInteraction]);

  const brushDebounce = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (brushDebounce.current !== null) window.clearTimeout(brushDebounce.current);
    },
    [],
  );

  const onBrushChange = useCallback(
    (range: BrushRange) => {
      actions.setBrush(range);
      if (!onInteraction) return;
      if (brushDebounce.current !== null) window.clearTimeout(brushDebounce.current);
      brushDebounce.current = window.setTimeout(() => onInteraction('brush x'), 150);
    },
    [actions, onInteraction],
  );

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4 p-4 md:p-6 lg:p-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">React dashboard (recharts)</h1>
          <p className="text-sm text-muted-foreground">
            Dataset + encodings + linked views (selection + brush).{' '}
            <a className="underline underline-offset-4" href={vacpDebugHref}>
              Enable VACP overlay
            </a>
            .
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Controls</CardTitle>
            <CardDescription>Select dataset and bind columns to x/y/color.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div className="flex flex-col gap-2">
                <div className="text-xs font-medium text-muted-foreground">Dataset</div>
                <Select value={datasetId} onValueChange={(v) => onSetDataset(v as DatasetId)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select dataset" />
                  </SelectTrigger>
                  <SelectContent>
                    {datasetOptions.map((d) => (
                      <SelectItem key={d.id} value={d.id} className="py-2">
                        <div className="flex flex-col">
                          <div className="font-medium">{d.title}</div>
                          <div className="text-xs text-muted-foreground">{d.description}</div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <div className="text-xs font-medium text-muted-foreground">X</div>
                <Select
                  value={encoding.x}
                  onValueChange={(v) => onSetEncoding({ x: v })}
                  disabled={!numericColumns.length}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="x" />
                  </SelectTrigger>
                  <SelectContent>
                    {numericColumns.map((k) => (
                      <SelectItem key={k} value={k}>
                        {k}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <div className="text-xs font-medium text-muted-foreground">Y</div>
                <Select
                  value={encoding.y}
                  onValueChange={(v) => onSetEncoding({ y: v })}
                  disabled={!numericColumns.length}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="y" />
                  </SelectTrigger>
                  <SelectContent>
                    {numericColumns.map((k) => (
                      <SelectItem key={k} value={k}>
                        {k}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <div className="text-xs font-medium text-muted-foreground">Color</div>
                <Select
                  value={encoding.color ?? '__none__'}
                  onValueChange={(v) => onSetEncoding({ color: v === '__none__' ? null : v })}
                  disabled={!allColumns.length}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="color" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">(none)</SelectItem>
                    {allColumns
                      .filter((k) => k !== encoding.x && k !== encoding.y && k.toLowerCase() !== 'id')
                      .map((k) => (
                        <SelectItem key={k} value={k}>
                          {k}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="ml-auto text-sm text-muted-foreground">
                {loading && 'Loading…'}
                {!loading && dataset && (
                  <>
                    <span className="font-medium text-foreground">{dataset.title}</span>
                    <span className="mx-2">·</span>
                    <span>{dataset.rows.length} rows</span>
                    <span className="mx-2">·</span>
                    <span>{brushedRows.length} brushed</span>
                    <span className="mx-2">·</span>
                    <span>{selectedIds.length} selected</span>
                  </>
                )}
              </div>
            </div>

            {dataset && <div className="text-xs text-muted-foreground">{dataset.description}</div>}
            {error && <div className="text-sm text-destructive">{error}</div>}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col space-y-1.5">
                  <CardTitle>Scatter</CardTitle>
                  <CardDescription>
                    Click points to toggle selection. Shift+drag to lasso-select. Double-click to reset selection.
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClearSelection}
                  disabled={!selectedIds.length}
                  aria-label="Reset selection"
                  title="Reset selection"
                >
                  <RotateCcw />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {dataset ? (
                <ScatterView
                  dataset={dataset}
                  rows={brushedRows}
                  encoding={encoding}
                  selectedIds={selectedIds}
                  onToggleSelectedId={onToggleSelectedId}
                  onApplyLassoSelection={onApplyLassoSelection}
                  onResetSelection={onClearSelection}
                />
              ) : (
                <div className="text-sm text-muted-foreground">Pick a dataset to begin.</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col space-y-1.5">
                  <CardTitle>Brush</CardTitle>
                  <CardDescription>
                    Rank plot of the x channel (sorted by {encoding.x}). Brush filters the scatter
                    {brushedXRangeLabel ? ` (x in ${brushedXRangeLabel}).` : '.'} Double-click to reset brush +
                    selection.
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClearBrush}
                  disabled={!brush}
                  aria-label="Reset brush"
                  title="Reset brush"
                >
                  <RotateCcw />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {dataset ? (
                <div onDoubleClick={onResetBrushAndSelection}>
                  <XBrushView sortedRows={sortedRows} xKey={encoding.x} brush={brush} onBrushChange={onBrushChange} />
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">Pick a dataset to begin.</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
