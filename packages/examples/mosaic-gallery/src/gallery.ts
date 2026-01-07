import type { Spec } from '@uwdata/mosaic-spec';
import { parse } from 'yaml';

export type GalleryMeta = { title: string; description?: string };
export type GalleryEntry = { id: string; meta: GalleryMeta; yaml: string; spec: Spec };

function fileIdFromPath(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.replace(/\.ya?ml$/i, '');
}

export function loadGallery(): GalleryEntry[] {
  const files = import.meta.glob('./specs/*.yaml', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>;

  return Object.entries(files)
    .map(([path, yaml]) => {
      const parsed = parse(yaml) as Record<string, unknown>;
      const metaRaw = parsed.meta as Record<string, unknown> | undefined;
      const meta: GalleryMeta = {
        title: typeof metaRaw?.title === 'string' ? metaRaw.title : fileIdFromPath(path),
        description: typeof metaRaw?.description === 'string' ? metaRaw.description : undefined,
      };
      const specObj = { ...parsed };
      delete specObj.meta;
      return { id: fileIdFromPath(path), meta, yaml, spec: specObj as unknown as Spec };
    })
    .sort((a, b) => a.meta.title.localeCompare(b.meta.title));
}
