import type { VegaLiteSpecLike } from '@vacp/vega-lite';

export type GalleryMeta = { id: string; title: string; description?: string };
export type GalleryEntry = { id: string; meta: GalleryMeta; createSpec: () => VegaLiteSpecLike };

function fileIdFromPath(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.replace(/\.tsx?$/i, '');
}

export function loadGallery(): GalleryEntry[] {
  const mods = import.meta.glob('./specs/*.ts', { eager: true }) as Record<
    string,
    { meta?: Partial<GalleryMeta>; createSpec?: () => VegaLiteSpecLike }
  >;

  return Object.entries(mods)
    .map(([path, mod]) => {
      const id = mod.meta?.id ?? fileIdFromPath(path);
      const title = mod.meta?.title ?? id;
      const description = mod.meta?.description;
      const createSpec = mod.createSpec ?? (() => ({}));
      return { id, meta: { id, title, description }, createSpec };
    })
    .sort((a, b) => a.meta.title.localeCompare(b.meta.title));
}
