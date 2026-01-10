export type VegaLitePlaybookEntry = {
  id: string;
  meta: { title: string; description?: string };
};

export type VegaLiteSpecPlaybookContext = {
  entry: VegaLitePlaybookEntry;
  viewBase: string;
};
