import type { Spec } from '@uwdata/mosaic-spec';
import { parse } from 'yaml';

export type GalleryEntry = { id: string; title: string; description?: string; spec: Spec };

export function loadGallery(): GalleryEntry[] {
  const files = import.meta.glob<string>('./specs/*.yaml', { eager: true, query: '?raw', import: 'default' });
  return Object.entries(files)
    .map(([path, yaml]) => {
      const id = path.slice(path.lastIndexOf('/') + 1, -'.yaml'.length);
      const { meta, ...spec }: Spec = parse(yaml);
      return { id, title: meta?.title ?? id, description: meta?.description, spec };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}
