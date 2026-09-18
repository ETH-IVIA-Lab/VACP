import { expect, test } from '@playwright/test';

import { startAppServer } from '../../helpers/devserver';
import { exampleDir } from '../../helpers/paths';

test('vgplot: menu inputs include options in capability graph (Voronoi Diagram)', async ({ page }) => {
  const srv = await startAppServer({ name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery') });

  try {
    await page.goto(`${srv.url}?vacp-inspector=1#voronoi`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!globalThis.__vacp);

    const widgets = await page.evaluate(async () => {
      const cap = await globalThis.__vacp.getCapabilities?.();
      const nodes = cap?.graph?.nodes ?? [];

      return nodes.filter((n: any) => n.kind === 'Widget');
    });

    const menus = widgets.filter((w: any) => /menu/i.test(String(w?.data?.kind ?? '')));
    expect(menus.length).toBeGreaterThanOrEqual(2);
    const byLabel = (label: string) => menus.find((w: any) => String(w?.title ?? '').includes(label));

    const mesh = byLabel('Delaunay Mesh');
    expect(mesh?.data?.optionsCount).toBeGreaterThanOrEqual(2);
    expect(mesh?.data?.options?.some((o: any) => o?.label === 'Hide')).toBeTruthy();
    expect(mesh?.data?.options?.some((o: any) => o?.label === 'Show')).toBeTruthy();

    const hull = byLabel('Convex Hull');
    expect(hull?.data?.optionsCount).toBeGreaterThanOrEqual(2);
    expect(hull?.data?.options?.some((o: any) => o?.label === 'Hide')).toBeTruthy();
    expect(hull?.data?.options?.some((o: any) => o?.label === 'Show')).toBeTruthy();
  } finally {
    await srv.stop();
  }
});
