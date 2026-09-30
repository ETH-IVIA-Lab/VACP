import {
  VACP_SCHEMA_VERSION,
  type VacpActionDescriptor,
  type VacpDataHandleData,
  type VacpDataHandleState,
  type VacpGraphFragment,
} from '@vacp/protocol';
import { listDatasets, type Dataset } from '../datasets/registry';
import { numericValues, quantile } from '../lib/dashboard';
import { selectionWhere } from './data';
import type { DashboardSnapshot } from './model';
import { dashboardRefs } from './refs';

function summarizeNumericField(dataset: Dataset, field: string) {
  const values = numericValues(dataset, field);
  return values.length ? { min: values[0]!, q1: quantile(values, 0.25) } : undefined;
}

export function projectDashboard(
  snapshot: DashboardSnapshot,
  actions: VacpActionDescriptor[],
  data: VacpDataHandleData,
  title: string,
) {
  const { dataset, datasetId, encoding, selectedIds, brush2d } = snapshot;
  const chartReason = !encoding.x || !encoding.y ? 'Choose both axes to display the chart' : undefined;
  const {
    appRef,
    viewRef,
    vizRef,
    scatterVizRef,
    distributionVizRef,
    distributionXVizRef,
    distributionYVizRef,
    tableVizRef,
    scatterRef,
    distributionXRef,
    distributionYRef,
    tableRef,
    selectionRef,
    brush2dRef,
    handleRef,
  } = dashboardRefs;
  const graph: VacpGraphFragment = {
    version: VACP_SCHEMA_VERSION,
    actions,
    nodes: [
      { ref: appRef, kind: 'App', layer: 'ViewLayer', title: 'VACP examples' },
      { ref: viewRef, kind: 'View', layer: 'ViewLayer', title },
      {
        ref: vizRef,
        availability: { requires: [handleRef] },
        kind: 'Visualization',
        layer: 'VisualizationLayer',
        title,
      },
      {
        ref: scatterVizRef,
        availability: { requires: [handleRef], unavailable: chartReason },
        kind: 'Visualization',
        layer: 'VisualizationLayer',
        title: 'scatter view',
        description: 'Scatterplot view (recharts).',
      },
      {
        ref: distributionVizRef,
        availability: { requires: [handleRef], unavailable: chartReason },
        kind: 'Visualization',
        layer: 'VisualizationLayer',
        title: 'distribution view',
        description: 'Distribution view (PDF histograms for x/y).',
      },
      {
        ref: distributionXVizRef,
        availability: { requires: [distributionVizRef] },
        kind: 'Visualization',
        layer: 'VisualizationLayer',
        title: 'distribution (x)',
        description: 'PDF histogram for the x encoding.',
      },
      {
        ref: distributionYVizRef,
        availability: { requires: [distributionVizRef] },
        kind: 'Visualization',
        layer: 'VisualizationLayer',
        title: 'distribution (y)',
        description: 'PDF histogram for the y encoding.',
      },
      {
        ref: tableVizRef,
        availability: { requires: [handleRef] },
        kind: 'Visualization',
        layer: 'VisualizationLayer',
        title: 'table view',
        description: 'Tabular view of rows (TanStack Table).',
      },
      {
        ref: scatterRef,
        availability: { requires: [scatterVizRef] },
        kind: 'Mark',
        layer: 'VisualizationLayer',
        title: 'scatter',
        description: 'recharts scatterplot',
      },
      {
        ref: distributionXRef,
        availability: { requires: [distributionVizRef] },
        kind: 'Mark',
        layer: 'VisualizationLayer',
        title: 'pdf (x)',
        description: 'Estimated PDF for the x encoding.',
      },
      {
        ref: distributionYRef,
        availability: { requires: [distributionVizRef] },
        kind: 'Mark',
        layer: 'VisualizationLayer',
        title: 'pdf (y)',
        description: 'Estimated PDF for the y encoding.',
      },
      {
        ref: tableRef,
        availability: { requires: [handleRef] },
        kind: 'Mark',
        layer: 'VisualizationLayer',
        title: 'data table',
        description: 'Rows rendered in a table.',
      },
      {
        ref: selectionRef,
        availability: { requires: [handleRef], unavailable: selectedIds.length ? undefined : 'No points selected' },
        kind: 'Selection',
        layer: 'InteractionFeedbackLayer',
        title: 'selected ids',
        description: 'Explicit point selection (by clicking points).',
      },
      {
        ref: brush2dRef,
        availability: { requires: [scatterRef], unavailable: brush2d ? undefined : 'No brush active' },
        kind: 'Selection',
        layer: 'InteractionFeedbackLayer',
        title: 'brush 2d',
        description: '2D rectangular brush selection (x/y data space).',
      },
      {
        ref: handleRef,
        availability: { unavailable: dataset ? undefined : 'Select a dataset' },
        kind: 'DataHandle',
        layer: 'DataLayer',
        title: 'rows (DuckDB handle)',
        description:
          'The active dataset, keyed by `id`. `vacp_handle` holds the selected points, or every row when none are selected, and `vacp_all` every row.',
        data,
      },
    ],
    edges: [
      { from: appRef, to: viewRef, kind: 'contains' },
      { from: viewRef, to: vizRef, kind: 'contains' },
      { from: vizRef, to: scatterVizRef, kind: 'contains' },
      { from: vizRef, to: distributionVizRef, kind: 'contains' },
      { from: vizRef, to: tableVizRef, kind: 'contains' },
      { from: scatterVizRef, to: scatterRef, kind: 'contains' },
      { from: scatterVizRef, to: selectionRef, kind: 'contains' },
      { from: scatterVizRef, to: brush2dRef, kind: 'contains' },
      { from: distributionVizRef, to: distributionXVizRef, kind: 'contains' },
      { from: distributionVizRef, to: distributionYVizRef, kind: 'contains' },
      { from: distributionXVizRef, to: distributionXRef, kind: 'contains' },
      { from: distributionYVizRef, to: distributionYRef, kind: 'contains' },
      { from: tableVizRef, to: tableRef, kind: 'contains' },
      { from: vizRef, to: handleRef, kind: 'contains' },
      { from: selectionRef, to: handleRef, kind: 'controls' },
      { from: brush2dRef, to: handleRef, kind: 'controls' },
    ],
  };

  const state = {
    [scatterRef]: { kind: 'Mark', datasetId, x: encoding.x, y: encoding.y, color: encoding.color },
    [distributionXRef]: { kind: 'Mark', datasetId, view: 'pdf', axis: 'x', field: encoding.x },
    [distributionYRef]: { kind: 'Mark', datasetId, view: 'pdf', axis: 'y', field: encoding.y },
    [tableRef]: { kind: 'Mark', datasetId },
    [selectionRef]: { kind: 'Selection', value: selectedIds },
    [brush2dRef]: {
      kind: 'Selection',
      x: encoding.x,
      y: encoding.y,
      x0: brush2d?.x0 ?? null,
      x1: brush2d?.x1 ?? null,
      y0: brush2d?.y0 ?? null,
      y1: brush2d?.y1 ?? null,
    },
    [handleRef]: {
      kind: 'DataHandle',
      rowCount: dataset?.rows.length ?? null,
      selectionWhere: selectionWhere(snapshot),
    } satisfies VacpDataHandleState,
  };
  const xStats = dataset && encoding.x ? summarizeNumericField(dataset, encoding.x) : undefined;
  const yStats = dataset && encoding.y ? summarizeNumericField(dataset, encoding.y) : undefined;
  const summary = {
    [viewRef]: {
      availableDatasets: listDatasets(),
      activeDatasetId: datasetId,
      activeEncoding: encoding,
      selectionHint:
        xStats && yStats
          ? { strategy: 'lower-quartile-cluster', x0: xStats.min, x1: xStats.q1, y0: yStats.min, y1: yStats.q1 }
          : undefined,
    },
  };
  return { graph, state, summary };
}
