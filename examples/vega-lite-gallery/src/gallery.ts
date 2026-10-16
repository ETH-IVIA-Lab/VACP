import type { TopLevelSpec } from 'vega-lite';

export type GalleryEntry = { id: string; title: string; description?: string; spec: TopLevelSpec };

const titleFromId = (id: string) =>
  id
    .split('-')
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(' ');

export function loadGallery(): GalleryEntry[] {
  const specs = import.meta.glob<TopLevelSpec>('./specs/*.vl.json', { eager: true, import: 'default' });
  return Object.entries(specs)
    .map(([path, spec]) => {
      const id = path.slice(path.lastIndexOf('/') + 1, -'.vl.json'.length);
      return {
        id,
        title: typeof spec.title === 'string' ? spec.title : titleFromId(id),
        description: spec.description,
        spec,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}
