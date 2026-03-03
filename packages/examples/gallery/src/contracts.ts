export type ExampleUnmount = void | (() => void | Promise<void>);

export type ExampleMount = (target: HTMLElement) => Promise<ExampleUnmount> | ExampleUnmount;

export type ExampleModule = {
  mount: ExampleMount;
};

type ManifestEntry = {
  id: string;
  route: string;
  title: string;
  description: string;
  folder: string;
  adapterModule: string;
  smokeSelector: string;
};

export function isManifestEntry(value: unknown): value is ManifestEntry {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.id === 'string' &&
    typeof rec.route === 'string' &&
    typeof rec.title === 'string' &&
    typeof rec.description === 'string' &&
    typeof rec.folder === 'string' &&
    typeof rec.adapterModule === 'string' &&
    typeof rec.smokeSelector === 'string'
  );
}

export function normalizeManifest(input: unknown): ManifestEntry[] {
  if (!Array.isArray(input)) throw new Error('Expected examples.manifest.json to be an array');
  const entries = input.filter(isManifestEntry);
  if (entries.length !== input.length) throw new Error('Invalid examples.manifest.json entry shape');
  return entries;
}
