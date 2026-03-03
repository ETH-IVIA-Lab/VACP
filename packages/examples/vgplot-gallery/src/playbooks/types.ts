import type { VgplotPlotLike, VgplotTableLike } from '@vacp/vgplot';

export type VgplotPlaybookEntry = {
  id: string;
  meta: { title: string; description?: string };
  spec: unknown;
};

export type VgplotSpecPlaybookContext = {
  entry: VgplotPlaybookEntry;
  viewBase: string;
  plots: Array<{ plotId: string; plot: VgplotPlotLike }>;
  tables: Array<{ tableId: string; table: VgplotTableLike }>;
};
