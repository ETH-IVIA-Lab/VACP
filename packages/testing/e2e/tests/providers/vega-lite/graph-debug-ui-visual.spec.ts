import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

import { startViteDevServer } from '../../helpers/devserver';
import { artifactDir, exampleDir } from '../../helpers/paths';

const artifactsDir = artifactDir('playwright-vega-lite-graph');

async function ensureArtifactsDir(): Promise<void> {
  await mkdir(artifactsDir, { recursive: true });
}

async function openDebugUi(page: Page): Promise<void> {
  const pill = page.locator('button.vacp-debug-ui-button');
  await expect(pill).toBeVisible({ timeout: 15_000 });
  await pill.click();
  await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible({ timeout: 15_000 });
}

async function waitForCapabilityRefContains(
  page: Page,
  needle: string,
  timeoutMs = 60_000,
): Promise<void> {
  const start = Date.now();
  while (true) {
    const ok = await page.evaluate(async (n) => {
      const caps = await (globalThis as any).__vacp.getCapabilities();
      const nodes = caps?.graph?.nodes ?? [];
      return nodes.some((x: any) => typeof x?.ref === 'string' && String(x.ref).includes(n));
    }, needle);
    if (ok) return;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for capability ref containing: ${needle}`);
    await page.waitForTimeout(150);
  }
}

function trackPageErrors(page: Page): () => void {
  const messages: string[] = [];
  page.on('pageerror', (error) => {
    messages.push(error.message);
  });
  return () => {
    expect(messages.length, `graph interactions should not throw page errors:\n${messages.join('\n')}`).toBe(0);
  };
}

test('vega-lite: debug-ui graph renders and selects mark/channel/field nodes for all gallery specs', async ({ page }) => {
  await ensureArtifactsDir();
  const expectNoPageErrors = trackPageErrors(page);
  const srv = await startViteDevServer({
    name: 'vega-lite-gallery',
    cwd: exampleDir('vega-lite-gallery'),
    artifactsDir,
  });
  try {
    await page.goto(`${srv.url}?vacp-debug=1`, { waitUntil: 'domcontentloaded' });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: srv.url });
    await page.waitForFunction(() => !!(globalThis as any).__vacp);

    await openDebugUi(page);
    const graphTab = page.getByRole('tab', { name: 'Graph' });
    await expect(graphTab).toBeVisible({ timeout: 15_000 });
    await graphTab.click();

    const specIds = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLSelectElement>('#spec option')).map((o) => o.value),
    );
    expect(specIds.length).toBeGreaterThanOrEqual(3);

    for (const specId of specIds) {
      await page.evaluate((id) => {
        const sel = document.querySelector<HTMLSelectElement>('#spec');
        if (!sel) throw new Error('Missing #spec');
        sel.value = id;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }, specId);

      await page.waitForSelector('#app canvas.marks, #app svg.marks', { timeout: 30_000 });
      await waitForCapabilityRefContains(page, `/vega-lite/${specId}/${specId}`);
      await expect(page.locator('[data-vacp-graph-flow="1"] .react-flow__node').first()).toBeVisible({
        timeout: 15_000,
      });

      await page.waitForFunction(() => {
        const flow = document.querySelector('[data-vacp-graph-flow="1"]');
        if (!flow) return false;
        const text = flow.textContent ?? '';
        if (!text.includes('Mark') || !text.includes('EncodingChannel') || !text.includes('EncodedField')) return false;
        return !text.includes('%2F') && !text.includes('%5B') && !text.includes('%5D');
      });

      if (specId === specIds[0]) {
        const rootNode = page.locator('[data-vacp-graph-node-kind="Visualization"]').first();
        await rootNode.getByRole('button', { name: /^Collapse / }).click();
        await expect(page.locator('[data-vacp-graph-node-kind="Mark"]')).toHaveCount(0);
        await expect(page.locator('[data-vacp-graph-node-kind="EncodingChannel"]')).toHaveCount(0);

        await rootNode.getByRole('button', { name: /^Expand .* one level$/ }).click();
        await expect(page.locator('[data-vacp-graph-node-kind="Mark"]').first()).toBeVisible();
        await expect(page.locator('[data-vacp-graph-node-kind="EncodingChannel"]')).toHaveCount(0);

        const markNode = page.locator('[data-vacp-graph-node-kind="Mark"]').first();
        await markNode.getByRole('button', { name: /^Expand .* one level$/ }).click();
        await expect(page.locator('[data-vacp-graph-node-kind="EncodingChannel"]').first()).toBeVisible();
        await expect(page.locator('[data-vacp-graph-node-kind="EncodedField"]')).toHaveCount(0);

        const channelNode = page.locator('[data-vacp-graph-node-kind="EncodingChannel"]').first();
        await channelNode.getByRole('button', { name: /^Expand .* one level$/ }).click();
        await expect(page.locator('[data-vacp-graph-node-kind="EncodedField"]').first()).toBeVisible();

        const graphNodeBodies = page.locator('[data-vacp-graph-flow="1"] [data-vacp-flow-node-kind]');
        const graphNodeWrappers = page
          .locator('[data-vacp-graph-flow="1"] .react-flow__node')
          .filter({ has: page.locator('[data-vacp-flow-node-kind]') });

        const firstNode = graphNodeBodies.first();
        await firstNode.click();
        await expect(page.locator('#vacp-debug-ui-panel')).toBeVisible();
        await expect(firstNode).toHaveClass(/vacp-debug-ui-flow-node-selected/);
        expectNoPageErrors();

        const secondNode = graphNodeWrappers.nth(1);
        await secondNode.press('Enter');
        await expect(secondNode.locator('.vacp-debug-ui-flow-node-selected')).toBeVisible();
        expectNoPageErrors();

        await page.getByRole('button', { name: 'Copy Mermaid' }).click();
        const copied = await page.evaluate(() => navigator.clipboard.readText());
        expect(copied).toContain('flowchart LR');
        expect(copied).toContain('Mark');
        expect(copied).toContain('EncodingChannel');
      }

      await page.locator('#vacp-debug-ui-panel').screenshot({
        path: resolve(artifactsDir, `vega-lite-${specId}-graph.png`),
      });
    }
  } finally {
    await srv.stop();
  }
});
