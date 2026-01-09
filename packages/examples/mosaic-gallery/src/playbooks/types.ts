import type { VgplotPlotLike, VgplotTableLike } from '@vacp/mosaic';

export type MosaicPlaybookEntry = {
  id: string;
  meta: { title: string; description?: string };
  spec: unknown;
};

export type MosaicSpecPlaybookContext = {
  entry: MosaicPlaybookEntry;
  viewBase: string;
  plots: Array<{ plotId: string; plot: VgplotPlotLike }>;
  tables: Array<{ tableId: string; table: VgplotTableLike }>;
};

