import { createHash } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { test, useWebMcp } from '../helpers/test';
import { appServer } from '../helpers/servers';
import { tool } from '../helpers/presence';

test.use({
  viewport: { width: 1440, height: 1600 },
});
useWebMcp();

async function rendered(page: Page, engine: 'vega-lite' | 'vgplot') {
  const pixels = await page.evaluate(
    async (engine) =>
      engine === 'vega-lite'
        ? Array.from(document.querySelectorAll<HTMLCanvasElement>('#app canvas'), (canvas) => canvas.toDataURL())
        : await Promise.all(
            Array.from(document.querySelectorAll('#app image'), async (image) => {
              const img = new Image();
              img.src = image.getAttribute('href')!;
              await img.decode();
              const canvas = document.createElement('canvas');
              canvas.width = img.width;
              canvas.height = img.height;
              const ctx = canvas.getContext('2d')!;
              ctx.drawImage(img, 0, 0);
              return canvas.toDataURL();
            }),
          ),
    engine,
  );
  return pixels.map((data) => createHash('sha256').update(data).digest('hex'));
}

for (const engine of ['vega-lite', 'vgplot'] as const) {
  test(`${engine} gallery streams public progress and replays native rendered checkpoints`, async ({
    page,
  }, testInfo) => {
    const server = appServer(`${engine}-gallery`);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${server.url}#${engine === 'vega-lite' ? 'seattle-weather' : 'nyc-taxi-rides'}`);
    // The taxi spec reads a remote dataset, so its tools can take a minute to register.
    await expect
      .poll(() => page.evaluate(async () => (await document.modelContext?.getTools())?.length ?? 0), {
        timeout: 60_000,
      })
      .toBeGreaterThan(0);
    const before = await rendered(page, engine);
    expect(before.length).toBeGreaterThan(0);
    await page.evaluate(() => {
      window.__vacpStream = window.__vacp!.beginAgentActivity({
        actor: { id: 'agent', kind: 'agent', label: 'Analyst' },
        summary: 'Looking at **patterns**',
      });
    });
    await page.evaluate(() => window.__vacpStream!.update('Looking at **patterns** across the selected area.'));
    await expect(page.locator('[data-vacp-summary]')).toContainText('selected area.');
    if (engine === 'vega-lite') {
      const graph = (await tool(page, 'vacp.observe')).graph;
      const selection = (title: string) =>
        graph.nodes.find((node: { kind: string; title: string }) => node.kind === 'Selection' && node.title === title)
          .ref;
      expect(
        (await tool(page, 'vega_lite.set_selection', { ref: selection('click'), value: { weather: 'rain' } })).ok,
      ).toBe(true);
      await expect.poll(() => rendered(page, engine)).not.toEqual(before);
      const first = await rendered(page, engine);
      const handleRef = graph.nodes.find((node: { kind: string }) => node.kind === 'DataHandle').ref;
      const bounds = await tool(page, 'vacp.data_sql', {
        handleRef,
        sql: 'SELECT min(monthdate_date) AS lo, max(monthdate_date) AS hi FROM vacp_handle WHERE month(date) BETWEEN 6 AND 8',
      });
      const { lo, hi } = bounds.result.rows[0];
      expect(
        (await tool(page, 'vega_lite.set_selection', { ref: selection('brush'), value: { x: [lo, hi] } })).ok,
      ).toBe(true);
      await expect.poll(() => rendered(page, engine)).not.toEqual(first);
      await verifyReplay(page, engine, first, await rendered(page, engine));
    } else {
      expect(
        (
          await tool(page, 'vgplot.set_interval_2d', {
            ref: 'vacp://vacp-examples/vgplot/nyc-taxi-rides/plot-0/interactor/0',
            x0: 982500,
            x1: 997500,
            y0: 202500,
            y1: 227500,
          })
        ).ok,
      ).toBe(true);
      await expect.poll(async () => (await rendered(page, engine))[1]).not.toBe(before[1]);
      const first = await rendered(page, engine);
      expect(
        (
          await tool(page, 'vgplot.set_interval_1d', {
            ref: 'vacp://vacp-examples/vgplot/nyc-taxi-rides/plot-2/interactor/0',
            min: 18,
            max: 22,
          })
        ).ok,
      ).toBe(true);
      await expect.poll(() => rendered(page, engine)).not.toEqual(first);
      await verifyReplay(page, engine, first, await rendered(page, engine));
      await expect(page.locator('#app .interval-xy rect.selection').first()).toBeVisible();
    }
    await page.screenshot({ path: testInfo.outputPath(`${engine}-replay.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}

async function verifyReplay(page: Page, engine: 'vega-lite' | 'vgplot', first: string[], last: string[]) {
  await page.evaluate(() => window.__vacpStream!.end({ summary: 'The **comparison** is ready.' }));
  const bubble = page.locator('[data-vacp-bubble]');
  await expect(bubble.locator('strong')).toHaveText('comparison');
  const label = bubble.locator('[data-vacp-heading]');
  const back = page.getByRole('button', { name: 'Previous analytical step' });
  const next = page.getByRole('button', { name: 'Next analytical step' });
  await expect(label).toHaveText('Conclusion');
  await bubble.hover();
  await back.click();
  await expect(label).toHaveText('Step 2 of 2');
  await expect.poll(() => rendered(page, engine)).toEqual(last);
  await back.click();
  await expect(label).toHaveText('Step 1 of 2');
  await expect.poll(() => rendered(page, engine)).toEqual(first);
  await expect(bubble).toHaveAttribute('aria-busy', 'false');
  await next.click();
  await expect(label).toHaveText('Step 2 of 2');
  await expect.poll(() => rendered(page, engine)).toEqual(last);
  await expect(bubble).toHaveAttribute('aria-busy', 'false');
  // The conclusion is the live view the request left behind.
  await next.click();
  await expect(label).toHaveText('Conclusion');
  await expect.poll(() => rendered(page, engine)).toEqual(last);
  await expect(page.getByRole('button', { name: 'Return to live analysis' })).toBeHidden();
}
