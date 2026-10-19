import { expect, type Page } from '@playwright/test';
import { test, useWebMcp } from '../helpers/test';
import type { VacpExecutionControl, VacpExecutionSource } from '@ethivia/vacp-protocol';
import { gotoApp } from '../helpers/servers';
import { tool } from '../helpers/presence';

declare global {
  interface Window {
    __vacpReplayGate?: { entered: boolean; release(): void; detach(): void };
  }
}

useWebMcp();

async function ageBrush(page: Page) {
  return page.locator('[data-view="age"] rect.selection').evaluate((element) => ({
    x: element.getAttribute('x'),
    width: element.getAttribute('width'),
  }));
}

test('native input abandons a pending restoration without rollback or late effects', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await gotoApp(page, 'athlete-explorer');
  expect((await tool(page, 'cohort.set_sports', { sports: ['canoe', 'rowing'] })).ok).toBe(true);
  expect(
    (
      await tool(page, 'vgplot.set_interval_1d', {
        ref: 'vacp://vacp-examples/athletes/age/interactor/0',
        min: 22,
        max: 28,
      })
    ).ok,
  ).toBe(true);
  await expect(page.locator('.athlete-summary strong').first()).toHaveText('506');
  expect((await tool(page, 'vacp.progress', { message: 'Paddlers aged 22 to 28 are in view.', done: true })).ok).toBe(
    true,
  );
  const bubble = page.locator('[data-vacp-bubble]');
  const back = page.getByRole('button', { name: 'Previous analytical step' });
  const close = page.getByRole('button', { name: 'Return to live analysis' });
  await expect(bubble.locator('[data-vacp-heading]')).toHaveText('Conclusion');
  await bubble.hover();
  // From the conclusion, the step before the age brush is two frames back.
  await back.click();
  await expect(bubble.locator('[data-vacp-heading]')).toHaveText('Step 2 of 2');
  await back.click();
  await expect(bubble).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.athlete-summary strong').first()).toHaveText('878');
  await expect(close).toBeVisible();
  // A harmless click inside the analytical root must not leave settled review.
  await page.locator('.athlete-intro h2').click();
  await bubble.hover();
  await expect(close).toBeVisible();
  await close.click();
  await expect(page.locator('.athlete-summary strong').first()).toHaveText('506');
  const original = await ageBrush(page);
  // Returning to live analysis dismissed the trail; a new agent turn offers it again.
  await expect(bubble).toHaveCount(0);
  await page.evaluate(() => window.__vacp!.beginAgentActivity({ actor: { id: 'agent', kind: 'agent' } }).end());
  await expect(back).toBeEnabled();

  await page.evaluate(() => {
    const runtime = window.__vacp! as typeof window.__vacp & VacpExecutionControl;
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gate = { entered: false, release, detach: () => {} };
    gate.detach = runtime.addExecutionGate(
      (execution) => {
        if (execution.restoration) {
          gate.entered = true;
          return pending;
        }
      },
      { stage: 'before', timeoutMs: 10_000 },
    );
    window.__vacpReplayGate = gate;
  });
  await bubble.hover();
  await back.click();
  await page.waitForFunction(() => window.__vacpReplayGate?.entered);
  await expect(bubble).toHaveAttribute('aria-busy', 'true');
  // This is a real browser gesture, not a synthesized event or a VACP action.
  const overlay = await page.locator('[data-view="age"] rect.overlay').boundingBox();
  expect(overlay).not.toBeNull();
  const start = { x: overlay!.x + overlay!.width * 0.42, y: overlay!.y + overlay!.height * 0.4 };
  const end = { x: overlay!.x + overlay!.width * 0.55, y: start.y + 12 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await expect(close).toBeHidden();
  await expect.poll(() => ageBrush(page)).not.toEqual(original);
  const humanBrush = await ageBrush(page);
  const humanCount = await page.locator('.athlete-summary strong').first().textContent();
  expect(humanCount).not.toBe('506');
  // Let the cancelled gate finish. Neither queued restoration nor saved baseline may overwrite the brush.
  await page.evaluate(() => {
    window.__vacpReplayGate!.release();
    window.__vacpReplayGate!.detach();
    delete window.__vacpReplayGate;
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const runtime = window.__vacp! as typeof window.__vacp & VacpExecutionSource;
        return runtime.getActiveExecutions().length;
      }),
    )
    .toBe(0);
  const result = await tool(page, 'vacp.data_sql', {
    handleRef: 'vacp://vacp-examples/athletes/data/main',
    sql: 'SELECT count(*)::INTEGER AS n FROM vacp_handle',
  });
  expect(result.ok).toBe(true);
  expect(Number(humanCount!.replaceAll(',', ''))).toBe(result.result.rows[0].n);
  expect(await ageBrush(page)).toEqual(humanBrush);
  await expect(page.locator('.athlete-summary strong').first()).toHaveText(humanCount!);
  await expect(close).toBeHidden();
  const records = await page.evaluate(() => window.__vacp!.getProvenance!().records);
  expect(
    records.some(
      (record) => record.kind === 'action' && record.execution.restoration && record.execution.phase === 'cancelled',
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
