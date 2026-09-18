import { expect, test, type Page } from '@playwright/test';

import { startAppServer } from '../../helpers/devserver';
import { exampleDir } from '../../helpers/paths';
import { executeOperation } from '../operations';

async function expectBridge(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      !!globalThis.__vacp &&
      typeof globalThis.__vacp.getCapabilities === 'function' &&
      typeof globalThis.__vacp.getRuntime === 'function',
  );
}

async function getCapabilities(page: Page): Promise<any> {
  return await page.evaluate(async () => await globalThis.__vacp.getCapabilities());
}

async function widgetOptions(
  page: Page,
  args: { ref: string; offset?: number; limit?: number; query?: string },
): Promise<any> {
  return executeOperation(page, 'vacp.widget_options', args);
}

async function waitForWidgetRef(page: Page, titleNeedle: string, timeoutMs = 30_000): Promise<string> {
  let ref: string | undefined;
  await expect
    .poll(
      async () => {
        const caps = await getCapabilities(page);
        ref = caps.graph.nodes.find(
          (node: { kind: string; ref: string; title?: string }) =>
            node.kind === 'Widget' && node.title?.includes(titleNeedle),
        )?.ref;
        return ref;
      },
      { timeout: timeoutMs, message: `Widget ${titleNeedle} becomes available` },
    )
    .toEqual(expect.any(String));
  return ref!;
}

test('widget option search returns matching sport choices', async ({ page }) => {
  const srv = await startAppServer({ name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery') });

  try {
    await page.goto(`${srv.url}#athletes`, { waitUntil: 'domcontentloaded' });
    await expectBridge(page);

    const sportRef = await waitForWidgetRef(page, 'Sport');

    let result: any;

    await expect
      .poll(
        async () => {
          result = await widgetOptions(page, { ref: sportRef, query: 'judo' });
          return result.ok
            ? result.result.options.map((option: { label?: string; value: unknown }) =>
                String(option.label ?? option.value).toLowerCase(),
              )
            : [];
        },
        { timeout: 15_000, message: 'Sport option search returns Judo' },
      )
      .toContain('judo');
    expect(result.result.count).toBeGreaterThan(0);
  } finally {
    await srv.stop();
  }
});
