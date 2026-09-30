import { expect } from '@playwright/test';
import { test } from '../helpers/test';
import { appServer } from '../helpers/servers';

test.use({
  exampleOptions: { paceAgentSteps: true },
  launchOptions: { args: ['--enable-experimental-web-platform-features', '--enable-features=WebMCPTesting'] },
});

test('thinking appears before execution, follows real athlete actions, and respects reduced motion and cancellation', async ({
  page,
}) => {
  const server = appServer('athlete-explorer');
  await page.goto(server.url);
  await page.waitForFunction(() => !!window.__vacp?.beginAgentActivity);
  await page.evaluate(() =>
    window.__vacp!.beginAgentActivity({
      actor: { id: 'webmcp', label: 'Analyst', kind: 'agent' },
      summary: 'Comparing rowers and canoeists',
    }),
  );
  const pointer = page.locator('[data-vacp-phase]');
  const bubble = page.locator('[data-vacp-bubble]');
  const painted = () =>
    pointer.evaluate((element: SVGGElement) => {
      const matrix = element.getScreenCTM()!;
      return `${matrix.e.toFixed(2)},${matrix.f.toFixed(2)}`;
    });
  await expect(pointer).toHaveAttribute('data-vacp-phase', 'thinking');
  await expect(bubble).toContainText('Comparing rowers and canoeists');
  const initial = await painted();
  await expect.poll(painted).not.toBe(initial);
  expect(await page.locator('[data-vacp-ripple]').count()).toBe(0);
  await page.waitForFunction(async () =>
    ((await document.modelContext?.getTools()) ?? []).some((tool) => tool.name === 'vacp.action.cohort.set_sports'),
  );
  const applied = await page.evaluate(async () => {
    const context = document.modelContext!;
    const tool = (await context.getTools()).find((tool) => tool.name === 'vacp.action.cohort.set_sports')!;
    return JSON.parse(
      await context.executeTool(
        tool,
        JSON.stringify({ sports: ['rowing', 'canoe'], narration: 'Comparing rowers and canoeists.' }),
      ),
    );
  });
  expect(applied.ok).toBe(true);
  await expect(page.locator('.athlete-summary strong').first()).toHaveText('878');
  await page.evaluate(() =>
    window.__vacp!.beginAgentActivity({ actor: { id: 'webmcp', kind: 'agent' }, summary: '<b>Public summary</b>' }),
  );
  await expect(bubble).toContainText('<b>Public summary</b>');
  await expect(bubble.locator('b')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const still = await painted();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await painted()).toBe(still);
  await page.evaluate(() => {
    const cancellation = new AbortController();
    window.__vacp!.beginAgentActivity({ actor: { id: 'webmcp', kind: 'agent' }, signal: cancellation.signal });
    cancellation.abort();
  });
  await expect(pointer).toHaveAttribute('data-vacp-phase', 'cancelled');
  // Turns cancelled before any step are not requests. The request that took a step stays on screen,
  // concluded like any other request, until the person dismisses it; its step keeps its own sentence.
  await expect(bubble.locator('[data-vacp-mark][data-busy]')).toHaveCount(0);
  const label = bubble.locator('[data-vacp-heading]');
  await expect(label).toHaveText('Conclusion', { timeout: 3000 });
  await expect(bubble).toHaveCount(1);
  await bubble.hover();
  await page.getByRole('button', { name: 'Previous analytical step' }).click();
  await expect(label).toHaveText('Step 1 of 1');
  await expect(bubble.locator('[data-vacp-summary]')).toContainText('Comparing rowers and canoeists');
  await page.getByRole('button', { name: 'Return to live analysis' }).click();
  await expect(bubble).toHaveCount(0);
});
