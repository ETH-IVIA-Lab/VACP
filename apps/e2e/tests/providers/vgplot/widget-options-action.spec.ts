import { expect } from '@playwright/test';
import { test } from '../../helpers/test';
import { appServer } from '../../helpers/servers';
import { executeOperation } from '../operations';

test('widget option search returns matching sport choices', async ({ page }) => {
  const server = appServer('vgplot-gallery');
  await page.goto(`${server.url}#athletes`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!globalThis.__vacp);
  const sportRef = await page.evaluate(async () => {
    const { graph } = await globalThis.__vacp.getCapabilities();
    const sport = graph.nodes.find((node) => node.kind === 'Widget' && node.title?.includes('Sport'));
    if (!sport) throw new Error('Missing Sport widget');
    return sport.ref;
  });
  await expect
    .poll(
      async () => {
        const result = await executeOperation(page, 'vacp.widget_options', { ref: sportRef, query: 'judo' });
        if (!result.ok) return [];
        return result.result.options.map((option: { label?: string; value: unknown }) =>
          String(option.label ?? option.value).toLowerCase(),
        );
      },
      { message: 'Sport option search returns Judo' },
    )
    .toContain('judo');
});
