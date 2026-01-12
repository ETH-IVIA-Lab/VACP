import { create } from 'zustand';

import { loadDataset, type Dataset, type DatasetId, type Encoding } from '@/datasets/registry';

export type BrushRange = { startIndex: number; endIndex: number } | null;
export type LassoPoint = { x: number; y: number };
export type LassoPolygon = LassoPoint[];

export type DashboardState = {
  datasetId: DatasetId;
  dataset: Dataset | null;
  encoding: Encoding;
  selectedIds: string[];
  lasso: LassoPolygon | null;
  brush: BrushRange;
  loading: boolean;
  error: string | null;
  actions: {
    init: () => Promise<void>;
    setDatasetId: (id: DatasetId) => Promise<void>;
    setEncoding: (patch: Partial<Encoding>) => void;
    toggleSelectedId: (id: string) => void;
    setSelectedIds: (ids: string[]) => void;
    applyLassoSelection: (polygon: LassoPolygon, ids: string[]) => void;
    clearSelection: () => void;
    clearLasso: () => void;
    setBrush: (range: BrushRange) => void;
    clearBrush: () => void;
  };
};

const DEFAULT_DATASET: DatasetId = 'iris';
const DEFAULT_ENCODING: Encoding = { x: 'SepalLengthCm', y: 'PetalLengthCm', color: 'Species' };

let loadSeq = 0;

export const useDashboardStore = create<DashboardState>((set, get) => ({
  datasetId: DEFAULT_DATASET,
  dataset: null,
  encoding: DEFAULT_ENCODING,
  selectedIds: [],
  lasso: null,
  brush: null,
  loading: false,
  error: null,
  actions: {
    init: async () => {
      const { dataset } = get();
      if (dataset) return;
      await get().actions.setDatasetId(get().datasetId);
    },
    setDatasetId: async (id) => {
      const seq = ++loadSeq;
      set({ datasetId: id, dataset: null, loading: true, error: null, selectedIds: [], lasso: null, brush: null });
      try {
        const dataset = await loadDataset(id);
        if (seq !== loadSeq) return;
        set({ dataset, encoding: dataset.defaultEncoding, loading: false });
      } catch (err) {
        if (seq !== loadSeq) return;
        set({ loading: false, error: err instanceof Error ? err.message : String(err) });
      }
    },
    setEncoding: (patch) => {
      set((s) => {
        const next: Encoding = { ...s.encoding, ...patch };
        const xChanged = patch.x !== undefined && patch.x !== s.encoding.x;
        return { encoding: next, brush: xChanged ? null : s.brush };
      });
    },
    toggleSelectedId: (id) => {
      set((s) => {
        const exists = s.selectedIds.includes(id);
        return { selectedIds: exists ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id], lasso: null };
      });
    },
    setSelectedIds: (ids) => {
      const uniq = Array.from(new Set(ids.map(String)));
      set({ selectedIds: uniq, lasso: null });
    },
    applyLassoSelection: (polygon, ids) => {
      const uniq = Array.from(new Set(ids.map(String)));
      set({ selectedIds: uniq, lasso: polygon.length ? polygon : null });
    },
    clearSelection: () => set({ selectedIds: [], lasso: null }),
    clearLasso: () => set({ lasso: null }),
    setBrush: (range) => {
      if (!range) return set({ brush: null });
      const startIndex = Math.max(0, Math.floor(range.startIndex));
      const endIndex = Math.max(startIndex, Math.floor(range.endIndex));
      set({ brush: { startIndex, endIndex } });
    },
    clearBrush: () => set({ brush: null }),
  },
}));
