import type { Dataset, DatasetId, Encoding } from '../datasets/registry';

export type DashboardSnapshot = {
  datasetId: DatasetId | null;
  dataset: Dataset | null;
  encoding: Encoding;
  selectedIds: string[];
  brush2d: { x0: number; x1: number; y0: number; y1: number } | null;
};

export type ReactDashboardModel = {
  subscribe: (invalidate: () => void) => () => void;
  read: () => DashboardSnapshot;
  setDatasetId: (id: DatasetId | null) => Promise<void>;
  setEncoding: (patch: Partial<Encoding>) => void;
  setSelectedIds: (ids: string[]) => void;
  toggleSelectedId: (id: string) => void;
  clearSelection: () => void;
  setBrush2d: (brush: { x0: number; x1: number; y0: number; y1: number } | null) => void;
  clearBrush2d: () => void;
};
