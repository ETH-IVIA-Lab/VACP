import { expect, test, type Page } from '@playwright/test';

import { startAppServer } from '../../helpers/devserver';
import { exampleDir } from '../../helpers/paths';

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
  return await page.evaluate(
    async ({ ref, offset, limit, query }) =>
      await globalThis.__vacp.execute({
        callId: crypto.randomUUID(),
        name: 'vacp.widget_options',
        params: { ref, offset, limit, query },
      }),
    args,
  );
}

async function waitForWidgetRef(page: Page, titleNeedle: string, timeoutMs = 30_000): Promise<string> {
  const start = Date.now();

  while (true) {
    const caps = await getCapabilities(page);
    const nodes = caps?.graph?.nodes ?? [];

    const found = nodes.find(
      (n: any) => n?.kind === 'Widget' && typeof n?.ref === 'string' && String(n?.title ?? '').includes(titleNeedle),
    );

    if (found?.ref) return String(found.ref);

    if (Date.now() - start > timeoutMs)
      throw new Error(`Timed out waiting for widget title containing: ${titleNeedle}`);
    await page.waitForTimeout(150);
  }
}

test('action: vacp.widget_options (vgplot athletes Sport menu)', async ({ page }) => {
  const srv = await startAppServer({ name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery') });

  try {
    await page.goto(`${srv.url}#athletes`, { waitUntil: 'domcontentloaded' });
    await expectBridge(page);

    const sportRef = await waitForWidgetRef(page, 'Sport');

    const caps = await getCapabilities(page);
    const actions = caps?.graph?.actions ?? [];
    expect(actions.some((a: any) => a?.name === 'vacp.widget_options')).toBeTruthy();

    let last: any = null;

    for (let i = 0; i < 30; i += 1) {
      last = await widgetOptions(page, { ref: sportRef, query: 'judo' });

      if (last?.ok && Array.isArray(last?.result?.options)) break;
      await page.waitForTimeout(150);
    }

    expect(last?.ok).toBeTruthy();
    expect(typeof last?.result?.count).toBe('number');
    expect(last?.result?.count).toBeGreaterThan(0);
    expect(Array.isArray(last?.result?.options)).toBeTruthy();
    expect(
      last?.result?.options?.some(
        (o: any) =>
          String(o?.label ?? '')
            .toLowerCase()
            .includes('judo') ||
          String(o?.value ?? '')
            .toLowerCase()
            .includes('judo'),
      ),
    ).toBeTruthy();
  } finally {
    await srv.stop();
  }
});
