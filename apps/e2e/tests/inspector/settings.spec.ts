import { expect, test, type Page } from '@playwright/test';

import { startAppServer } from '../helpers/devserver';
import { exampleDir } from '../helpers/paths';
import { waitForVacpBridge } from './helpers';

const FEATURE_FLAGS = [
  {
    label: 'Inspector',
    storageKey: 'vacp:inspector',
  },
  {
    label: 'Bridge exposure',
    storageKey: 'vacp:expose-bridge',
  },
  {
    label: 'DOM snapshot',
    storageKey: 'vacp:dom-snapshot',
  },
  {
    label: 'Raw SQL action',
    storageKey: 'vacp:enable-sql',
  },
] as const;

async function openSettings(page: Page): Promise<void> {
  const pill = page.locator('button.vacp-inspector-button');
  await expect(pill).toBeVisible();
  await pill.click();

  const panel = page.locator('#vacp-inspector-panel');
  await expect(panel).toBeVisible();
  await page.getByRole('tab', { name: 'Settings' }).click();
}

function settingSection(page: Page, label: string) {
  return page.locator('section', { has: page.getByRole('switch', { name: `Toggle ${label}` }) });
}

test('inspector: settings persist browser overrides through the panel contract', async ({ page }) => {
  const srv = await startAppServer({
    name: 'cars-parallel-coords',
    cwd: exampleDir('cars-parallel-coords'),
  });

  try {
    await page.goto(srv.url, { waitUntil: 'domcontentloaded' });
    await waitForVacpBridge(page);
    await openSettings(page);

    await expect(page.getByRole('dialog')).toContainText('Feature flags');

    for (const flag of FEATURE_FLAGS) {
      const section = settingSection(page, flag.label);
      const flagSwitch = page.getByRole('switch', { name: `Toggle ${flag.label}` });
      await expect(section).toContainText(flag.label);
      await expect(section).toContainText('Default');
      await expect(section).toContainText('On');
      await expect(flagSwitch).toHaveAttribute('aria-checked', 'true');

      await flagSwitch.click();
      await expect(section).toContainText('Browser');
      await expect(section).toContainText('Off');
      await expect(flagSwitch).toHaveAttribute('aria-checked', 'false');
      await expect.poll(async () => await page.evaluate((key) => localStorage.getItem(key), flag.storageKey)).toBe('0');

      await page.getByRole('button', { name: `Clear ${flag.label} browser override` }).click();
      await expect(section).toContainText('Default');
      await expect(section).toContainText('On');
      await expect(flagSwitch).toHaveAttribute('aria-checked', 'true');
      await expect
        .poll(async () => await page.evaluate((key) => localStorage.getItem(key), flag.storageKey))
        .toBeNull();
    }

    const rawSqlRow = settingSection(page, 'Raw SQL action');
    const rawSqlSwitch = page.getByRole('switch', { name: 'Toggle Raw SQL action' });
    await rawSqlSwitch.click();
    await expect(rawSqlRow).toContainText('Browser');
    await expect(rawSqlRow).toContainText('Off');
    await expect(page.getByRole('button', { name: 'Reload' })).toBeEnabled();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForVacpBridge(page);

    const actionsAfterReload = await page.evaluate(async () => {
      const caps = await globalThis.__vacp.getCapabilities();

      return (caps?.graph?.actions ?? []).map((action: any) => action?.name);
    });

    expect(actionsAfterReload).toEqual(expect.arrayContaining(['parallel_coords.set_dimension_order']));
    expect(actionsAfterReload.filter((name) => name === 'vacp.data_sql')).toEqual([]);

    const disabledSql = await page.evaluate(async () => {
      return await globalThis.__vacp.execute({
        callId: crypto.randomUUID(),
        name: 'vacp.data_sql',
        params: { handleRef: 'vacp://example/data/main', sql: 'SELECT 1' },
      });
    });

    expect(disabledSql?.ok).toBe(false);
    expect(String(disabledSql?.error?.message ?? '')).toContain('Unknown action');
    await openSettings(page);
    await expect(rawSqlRow).toContainText('Browser');
    await expect(rawSqlRow).toContainText('Off');
    await expect(rawSqlSwitch).toHaveAttribute('aria-checked', 'false');

    await page.getByRole('button', { name: 'Clear Raw SQL action browser override' }).click();
    await expect(rawSqlRow).toContainText('Default');
    await expect(rawSqlRow).toContainText('On');
    await expect(rawSqlSwitch).toHaveAttribute('aria-checked', 'true');
  } finally {
    await srv.stop();
  }
});
