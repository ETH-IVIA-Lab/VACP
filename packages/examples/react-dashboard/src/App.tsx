import { useCallback, useEffect, useMemo } from 'react';
import { Database, Loader2, RotateCcw, SlidersHorizontal, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { listDatasets, type DatasetId, type Encoding } from '@/datasets/registry';
import { ScatterView } from '@/components/charts/scatter-view';
import { PdfDistributionView } from '@/components/charts/pdf-distribution-view';
import { DataTable } from '@/components/data-table';
import { PlaceholderPanel } from '@/components/placeholder-panel';
import { getColumns, getNumericColumns } from '@/lib/dashboard';
import { useDashboardStore } from '@/state/dashboard-store';

type Props = {
  onInteraction?: (message: string) => void;
};

const datasetOptions = listDatasets();
const chartPanelHeight = 'h-[340px] min-h-0 md:h-[380px]';

export default function App({ onInteraction }: Props) {
  const { datasetId, dataset, encoding, selectedIds, brush2d, loading, error, actions } = useDashboardStore();

  const numericColumns = useMemo(() => (dataset ? getNumericColumns(dataset) : []), [dataset]);
  const allColumns = useMemo(() => (dataset ? getColumns(dataset) : []), [dataset]);

  useEffect(() => {
    if (!dataset) return;

    const patch: Partial<Encoding> = {};
    if (encoding.x && !numericColumns.includes(encoding.x)) patch.x = null;
    if (encoding.y && !numericColumns.includes(encoding.y)) patch.y = null;
    if (encoding.color && !allColumns.includes(encoding.color)) patch.color = null;
    if (Object.keys(patch).length) actions.setEncoding(patch);
  }, [actions, allColumns, dataset, encoding.color, encoding.x, encoding.y, numericColumns]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedRows = useMemo(
    () => (dataset ? dataset.rows.filter((r) => selectedSet.has(r.id)) : []),
    [dataset, selectedSet],
  );
  const rowsForDetails = selectedRows.length ? selectedRows : (dataset?.rows ?? []);

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

  const onSetBrush2d = useCallback(
    (brush: { x0: number; x1: number; y0: number; y1: number }) => {
      actions.setBrush2d(brush);
      onInteraction?.('brush selection');
    },
    [actions, onInteraction],
  );

  const onClearSelection = useCallback(() => {
    actions.clearSelection();
    onInteraction?.('clear selection');
  }, [actions, onInteraction]);

  const isLoadingDataset = Boolean(datasetId && loading && !dataset);
  const isMissingDataset = !dataset && !isLoadingDataset;

  const onUseRecommendedEncoding = useCallback(() => {
    if (!dataset) return;
    actions.setEncoding(dataset.defaultEncoding);
    onInteraction?.('set encoding: recommended defaults');
  }, [actions, dataset, onInteraction]);

  return (
    <div className="h-screen overflow-hidden bg-muted/30">
      <div className="mx-auto flex h-full w-full max-w-[1800px] flex-col gap-4 p-4 lg:flex-row lg:gap-6 lg:p-6">
        <aside className="w-full lg:h-full lg:w-[360px] lg:shrink-0 lg:overflow-auto">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Controls</CardTitle>
              <CardDescription>Dataset + encodings</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-medium text-muted-foreground">Dataset</div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => {
                      void actions.setDatasetId(null);
                      onInteraction?.('clear dataset');
                    }}
                    disabled={!datasetId}
                    aria-label="Clear dataset"
                    title="Clear dataset"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <Select value={datasetId ?? undefined} onValueChange={(v) => onSetDataset(v as DatasetId)}>
                  <SelectTrigger className={!datasetId ? 'border-primary/40 ring-1 ring-primary/20' : undefined}>
                    <SelectValue placeholder="Select dataset" />
                  </SelectTrigger>
                  <SelectContent>
                    {datasetOptions.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-medium text-muted-foreground">X</div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        actions.setEncoding({ x: null });
                        onInteraction?.('clear x encoding');
                      }}
                      disabled={!encoding.x}
                      aria-label="Clear x encoding"
                      title="Clear x encoding"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <Select
                    value={encoding.x ?? undefined}
                    onValueChange={(v) => onSetEncoding({ x: v })}
                    disabled={!numericColumns.length}
                  >
                    <SelectTrigger
                      className={
                        dataset && !loading && !encoding.x ? 'border-primary/40 ring-1 ring-primary/20' : undefined
                      }
                    >
                      <SelectValue placeholder="Select x field" />
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
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-medium text-muted-foreground">Y</div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        actions.setEncoding({ y: null });
                        onInteraction?.('clear y encoding');
                      }}
                      disabled={!encoding.y}
                      aria-label="Clear y encoding"
                      title="Clear y encoding"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <Select
                    value={encoding.y ?? undefined}
                    onValueChange={(v) => onSetEncoding({ y: v })}
                    disabled={!numericColumns.length}
                  >
                    <SelectTrigger
                      className={
                        dataset && !loading && !encoding.y ? 'border-primary/40 ring-1 ring-primary/20' : undefined
                      }
                    >
                      <SelectValue placeholder="Select y field" />
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

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>{loading ? 'Loading…' : dataset ? dataset.title : 'No dataset'}</span>
                  <span>{dataset ? `${dataset.rows.length} rows` : ''}</span>
                </div>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>{selectedIds.length ? `${selectedIds.length} selected` : 'No selection'}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onClearSelection}
                    disabled={!selectedIds.length}
                    aria-label="Clear selection"
                    title="Clear selection"
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Clear
                  </Button>
                </div>
              </div>

              {dataset && <div className="text-xs text-muted-foreground">{dataset.description}</div>}
              {error && <div className="text-sm text-destructive">{error}</div>}
            </CardContent>
          </Card>
        </aside>

        <main className="min-w-0 flex-1 flex min-h-0 flex-col">
          <header className="flex flex-col gap-1 pb-3">
            <h1 className="text-xl font-semibold tracking-tight">React dashboard (recharts)</h1>
            <p className="text-sm text-muted-foreground">
              Linked views via shared selection (point toggle, PDF bin, 2D brush). Double-click a chart to clear.
            </p>
          </header>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card className="flex flex-col">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col space-y-1.5">
                    <CardTitle>Scatter</CardTitle>
                    <CardDescription>
                      Click points to toggle selection. Drag to brush-select; drag brush to move.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col">
                {dataset && encoding.x && encoding.y ? (
                  <div className={chartPanelHeight}>
                    <ScatterView
                      dataset={dataset}
                      rows={dataset.rows}
                      encoding={{ x: encoding.x, y: encoding.y, color: encoding.color }}
                      selectedIds={selectedIds}
                      brush2d={brush2d}
                      onToggleSelectedId={onToggleSelectedId}
                      onSetBrush2d={onSetBrush2d}
                      onClearSelection={onClearSelection}
                    />
                  </div>
                ) : (
                  <div className={chartPanelHeight}>
                    {isLoadingDataset ? (
                      <PlaceholderPanel
                        icon={<Loader2 className="h-5 w-5 animate-spin" />}
                        title="Loading dataset…"
                        description="Preparing rows and columns for the dashboard."
                      />
                    ) : isMissingDataset ? (
                      <PlaceholderPanel
                        icon={<Database className="h-5 w-5" />}
                        title="Pick a dataset to begin"
                        description="Choose a dataset in Controls to populate the charts and table."
                        actions={datasetOptions.map((d) => (
                          <Button
                            key={d.id}
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => onSetDataset(d.id)}
                          >
                            {d.title}
                          </Button>
                        ))}
                      />
                    ) : (
                      <PlaceholderPanel
                        icon={<SlidersHorizontal className="h-5 w-5" />}
                        title="Pick X and Y fields"
                        description="Select numeric fields in Controls to render the charts. Then click points to select, drag to brush-select, and double-click a chart to clear."
                        actions={
                          dataset ? (
                            <Button type="button" variant="secondary" size="sm" onClick={onUseRecommendedEncoding}>
                              Use recommended fields
                            </Button>
                          ) : null
                        }
                      />
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="flex flex-col">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col space-y-1.5">
                    <CardTitle>Distribution (PDF)</CardTitle>
                    <CardDescription>
                      {encoding.x && encoding.y ? (
                        <>
                          PDF estimate for {encoding.x} and {encoding.y}.
                          {selectedIds.length ? ' Uses the selected subset; clear selection to view all.' : ''}
                        </>
                      ) : (
                        <>Pick X and Y fields to view distributions.</>
                      )}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col">
                {dataset && encoding.x && encoding.y ? (
                  <div className={chartPanelHeight}>
                    <PdfDistributionView
                      rows={dataset.rows}
                      selectedIds={selectedIds}
                      xKey={encoding.x}
                      yKey={encoding.y}
                      onClearSelection={onClearSelection}
                      onSetSelectedIds={(ids) => {
                        actions.setSelectedIds(ids);
                        onInteraction?.('select distribution bin');
                      }}
                    />
                  </div>
                ) : (
                  <div className={chartPanelHeight}>
                    {isLoadingDataset ? (
                      <PlaceholderPanel
                        icon={<Loader2 className="h-5 w-5 animate-spin" />}
                        title="Loading dataset…"
                        description="Preparing rows and columns for the dashboard."
                      />
                    ) : isMissingDataset ? (
                      <PlaceholderPanel
                        icon={<Database className="h-5 w-5" />}
                        title="Pick a dataset to begin"
                        description="Choose a dataset in Controls to populate the charts and table."
                      />
                    ) : (
                      <PlaceholderPanel
                        icon={<SlidersHorizontal className="h-5 w-5" />}
                        title="Pick X and Y fields"
                        description="Select numeric fields in Controls to render the distributions. Click bars to filter; double-click a chart to clear."
                        actions={
                          dataset ? (
                            <Button type="button" variant="secondary" size="sm" onClick={onUseRecommendedEncoding}>
                              Use recommended fields
                            </Button>
                          ) : null
                        }
                      />
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="mt-4 flex min-h-0 flex-1 flex-col">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col space-y-1.5">
                  <CardTitle>Data Table</CardTitle>
                  <CardDescription>
                    {selectedIds.length
                      ? `Showing ${rowsForDetails.length} selected rows.`
                      : dataset
                        ? `Showing ${rowsForDetails.length} rows. Click points (or distribution bars) to filter.`
                        : ''}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 p-4 pt-0">
              {dataset ? (
                <DataTable
                  columns={allColumns}
                  rows={rowsForDetails}
                  selectedIds={selectedIds}
                  encoding={{ x: encoding.x, y: encoding.y, color: encoding.color ?? null }}
                  height="100%"
                />
              ) : (
                <PlaceholderPanel
                  icon={<Database className="h-5 w-5" />}
                  title="Pick a dataset to begin"
                  description="Choose a dataset in Controls to explore rows in the table."
                  className="h-full"
                />
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}
