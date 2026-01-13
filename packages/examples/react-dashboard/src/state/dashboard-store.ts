import { create } from 'zustand';

import { loadDataset, type Dataset, type DatasetId, type Encoding } from '@/datasets/registry';
import { toFiniteNumber } from '@/lib/dashboard';

export type DashboardState = {
  datasetId: DatasetId;
  dataset: Dataset | null;
  encoding: Encoding;
  selectedIds: string[];
  brush2d: { x0: number; x1: number; y0: number; y1: number } | null;
  loading: boolean;
  error: string | null;
  actions: {
    init: () => Promise<void>;
    setDatasetId: (id: DatasetId) => Promise<void>;
    setEncoding: (patch: Partial<Encoding>) => void;
    toggleSelectedId: (id: string) => void;
    setSelectedIds: (ids: string[]) => void;
    clearSelection: () => void;
    setBrush2d: (brush: { x0: number; x1: number; y0: number; y1: number } | null) => void;
    clearBrush2d: () => void;
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
  brush2d: null,
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
      set({ datasetId: id, dataset: null, loading: true, error: null, selectedIds: [], brush2d: null });
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
      set((s) => ({ encoding: { ...s.encoding, ...patch } }));
    },
    toggleSelectedId: (id) => {
      set((s) => {
        const exists = s.selectedIds.includes(id);
        return { selectedIds: exists ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id], brush2d: null };
      });
    },
    setSelectedIds: (ids) => {
      const uniq = Array.from(new Set(ids.map(String)));
      set({ selectedIds: uniq, brush2d: null });
    },
    clearSelection: () => set({ selectedIds: [], brush2d: null }),
    setBrush2d: (brush) => {
      if (!brush) {
        set({ brush2d: null, selectedIds: [] });
        return;
      }

      const x0 = Number(brush.x0);
      const x1 = Number(brush.x1);
      const y0 = Number(brush.y0);
      const y1 = Number(brush.y1);
      if (![x0, x1, y0, y1].every((v) => Number.isFinite(v))) {
        set({ brush2d: null, selectedIds: [] });
        return;
      }

      const dataset = get().dataset;
      const encoding = get().encoding;
      if (!dataset) {
        set({ brush2d: { x0, x1, y0, y1 }, selectedIds: [] });
        return;
      }

      const minX = Math.min(x0, x1);
      const maxX = Math.max(x0, x1);
      const minY = Math.min(y0, y1);
      const maxY = Math.max(y0, y1);

      const selectedIds = dataset.rows
        .flatMap((row) => {
          const x = toFiniteNumber(row[encoding.x]);
          const y = toFiniteNumber(row[encoding.y]);
          if (x === null || y === null) return [];
          if (x < minX || x > maxX) return [];
          if (y < minY || y > maxY) return [];
          return [row.id];
        })
        .map(String);

      set({ brush2d: { x0, x1, y0, y1 }, selectedIds });
    },
    clearBrush2d: () => set({ brush2d: null, selectedIds: [] }),
  },
}));
