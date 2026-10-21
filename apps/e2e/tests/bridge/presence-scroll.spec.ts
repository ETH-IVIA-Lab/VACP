import { expect, type Page } from '@playwright/test';
import { test, useWebMcp } from '../helpers/test';
import { gotoApp } from '../helpers/servers';
import { tool } from '../helpers/presence';

test.use({
  exampleOptions: { paceAgentSteps: true },
});
useWebMcp();
async function aligned(page: Page, selector: string, anchor: 'corner' | 'center' = 'corner') {
  return page.evaluate(
    ({ selector, anchor }) => {
      const rect = document.querySelector(selector)!.getBoundingClientRect();
      const shadow = document.querySelector('[data-vacp-presence]')!.shadowRoot!;
      const cue = shadow.querySelector<SVGPathElement>('path[data-precision]')!;
      const box = cue.getBoundingClientRect();
      const pointer = shadow.querySelector<SVGGElement>('g[data-vacp-phase]')!;
      const matrix = pointer.getScreenCTM()!;
      const x = rect.x + (anchor === 'center' ? rect.width / 2 : 0);
      const y = rect.y + (anchor === 'center' ? rect.height / 2 : 0);
      return Math.max(
        Math.abs(box.x - rect.x),
        Math.abs(box.y - rect.y),
        Math.abs(box.width - rect.width),
        Math.abs(box.height - rect.height),
        Math.abs(matrix.e - x),
        Math.abs(matrix.f - y),
      );
    },
    { selector, anchor },
  );
}
async function frames(page: Page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test('human provenance stays invisible while retained agent presence follows document and nested scrolling', async ({
  page,
}, testInfo) => {
  await gotoApp(page, 'athlete-explorer');
  // The dashboard fits a laptop viewport; trailing page content lets document scrolling carry it out of view.
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div style="height:1600px"></div>'));
  await page.getByRole('combobox', { name: 'Sex' }).selectOption('female');
  await page.locator('[data-sport="canoe"]').click();
  await expect(page.locator('[data-vacp-bubble]')).toHaveCount(0);
  await expect(page.locator('[data-vacp-phase]')).toHaveCount(0);
  expect(
    await page.evaluate(
      async () =>
        window
          .__vacp!.getProvenance()
          .records.filter((entry) => entry.kind === 'observation' && entry.actor.kind === 'human').length,
    ),
  ).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => scrollTo(0, 0));
  expect((await tool(page, 'cohort.set_sex', { sex: 'male' })).ok).toBe(true);
  expect(
    (
      await tool(page, 'vgplot.set_interval_1d', {
        ref: 'vacp://vacp-examples/athletes/age/interactor/0',
        min: 22,
        max: 28,
      })
    ).ok,
  ).toBe(true);
  expect((await tool(page, 'vacp.progress', { message: 'Men aged 22 to 28 are in view.', done: true })).ok).toBe(true);
  // The finished request's recorded steps keep tracking the page as it scrolls.
  const bubble = page.locator('[data-vacp-bubble]');
  await expect(bubble.locator('[data-vacp-heading]')).toHaveText('Conclusion');
  await bubble.hover();
  await page.getByRole('button', { name: 'Previous step' }).click();
  await expect(bubble.locator('[data-vacp-heading]')).toHaveText('Step 2 of 2');
  await expect(bubble).toHaveAttribute('aria-busy', 'false');
  for (const y of [60, 140, 0]) {
    await page.evaluate((y) => scrollTo(0, y), y);
    await frames(page);
    expect(await aligned(page, '[data-view="age"] rect.selection')).toBeLessThan(2);
  }
  await page.screenshot({ path: testInfo.outputPath('agent-scroll.png'), fullPage: false });
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await expect(bubble).toBeVisible();
  await expect(page.locator('g[data-vacp-phase]')).toBeHidden();
  await page.evaluate(() => scrollTo(0, 0));
  await expect(bubble).toBeVisible();
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('#athletes-root')!;
    root.style.height = '650px';
    root.style.overflow = 'auto';
    root.scrollTop = 180;
  });
  await expect.poll(() => aligned(page, '[data-view="age"] rect.selection')).toBeLessThan(2);
  await page.evaluate(() => {
    document.querySelector('#athletes-root')!.scrollTop = 80;
  });
  await frames(page);
  expect(await aligned(page, '[data-view="age"] rect.selection')).toBeLessThan(2);
  await page.evaluate(() => {
    document.querySelector('#athletes-root')!.scrollTop = 0;
  });
  await page.getByRole('button', { name: 'Previous step' }).click();
  await expect(bubble).toHaveAttribute('aria-busy', 'false');
  await expect.poll(() => aligned(page, 'select[aria-label="Sex"]', 'center')).toBeLessThan(2);
  await page.evaluate(() => {
    // The compact header keeps the control near the top; a small scroll still moves it without clipping.
    document.querySelector('#athletes-root')!.scrollTop = 24;
  });
  await frames(page);
  expect(await aligned(page, 'select[aria-label="Sex"]', 'center')).toBeLessThan(2);
  await expect(bubble).toContainText(/Step \d+ of \d+/);
  await expect(bubble.locator('[data-vacp-mark] svg')).toBeVisible();
  await page.getByRole('button', { name: 'Return to the live view' }).click();
  await page.getByRole('combobox', { name: 'Sex' }).selectOption('female');
  await expect(bubble).toHaveCount(0);
  expect(
    await page.evaluate(async () =>
      window
        .__vacp!.getProvenance()
        .records.some((entry) => entry.kind === 'observation' && entry.actor.kind === 'human'),
    ),
  ).toBe(true);
});
