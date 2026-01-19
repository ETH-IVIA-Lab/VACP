import type { VegaLiteSpecLike } from '@vacp/vega-lite';

export type GalleryMeta = { id: string; title: string; description?: string };
export type GalleryEntry = { id: string; meta: GalleryMeta; createSpec: () => VegaLiteSpecLike };

function fileIdFromPath(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.replace(/\.vl\.json$/i, '').replace(/\.json$/i, '').replace(/\.tsx?$/i, '');
}

function titleFromId(id: string): string {
  const base = id.replace(/^\d+-/, '');
  return base
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join(' ');
}

export function loadGallery(): GalleryEntry[] {
  const mods = import.meta.glob('./specs/*.vl.json', { eager: true }) as Record<
    string,
    { default: VegaLiteSpecLike; meta?: Partial<GalleryMeta>; createSpec?: () => VegaLiteSpecLike }
  >;

  return Object.entries(mods)
    .map(([path, mod]) => {
      const id = mod.meta?.id ?? fileIdFromPath(path);
      const spec = mod.default;
      const specTitle = typeof spec.title === 'string' ? spec.title : undefined;
      const specDescription = typeof spec.description === 'string' ? spec.description : undefined;

      const title = mod.meta?.title ?? specTitle ?? titleFromId(id);
      const description = mod.meta?.description ?? specDescription;

      const createSpec =
        mod.createSpec ??
        (() => {
          // Ensure switching between examples never shares a mutated spec object.
          if (typeof structuredClone === 'function') return structuredClone(spec);
          return JSON.parse(JSON.stringify(spec)) as VegaLiteSpecLike;
        });

      return { id, meta: { id, title, description }, createSpec };
    })
    .sort((a, b) => a.meta.title.localeCompare(b.meta.title));
}
