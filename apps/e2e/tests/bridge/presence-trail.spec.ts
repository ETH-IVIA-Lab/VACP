import { expect } from '@playwright/test';
import { test } from '../helpers/test';
import { repoRoot } from '../helpers/paths';
import { gotoApp } from '../helpers/servers';

test('a focused trail step keeps focus as the request gains another step', async ({ page }) => {
  await gotoApp(page, 'vega-lite-gallery');
  const result = await page.evaluate(async (root) => {
    const { measureGrowingTrailFocus } = await import(`/@fs${root}/apps/e2e/fixtures/presence.ts`);
    return measureGrowingTrailFocus();
  }, repoRoot);
  expect(result).toEqual({
    focused: 'Step 1 of 3',
    retained: true,
    names: ['Start', 'Step 1 of 3', 'Step 2 of 3', 'Step 3 of 3', 'Conclusion'],
  });
});
