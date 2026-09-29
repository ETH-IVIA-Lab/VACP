import { expect } from '@playwright/test';
import { test } from '../../helpers/test';

import { appServer } from '../../helpers/servers';
import { executeOperation } from '../operations';

type Hover = { tooltip: Record<string, string> | null; matches: number };

test('vega-lite: pointing at a mark reports the tooltip shown and how many marks match', async ({ page }) => {
  const srv = appServer('vega-lite-gallery');
  await page.goto(`${srv.url}#airports`, { waitUntil: 'domcontentloaded' });
  await expect
    .poll(
      () =>
        page.evaluate(async () =>
          ((await globalThis.__vacp?.getCapabilities())?.graph.actions ?? []).some(
            (action: { operation?: { contract?: string } }) => action.operation?.contract === 'vega_lite.hover_tooltip',
          ),
        ),
      { timeout: 60_000 },
    )
    .toBe(true);
  const tooltip = page.locator('#vg-tooltip-element');
  const hover = async (fields: Record<string, string>) => {
    const result = await executeOperation(page, 'vega_lite.hover_tooltip', { fields });
    expect(result.ok).toBe(true);
    return (result as { result: Hover }).result;
  };
  const airport = { Airport: 'William B Hartsfield-Atlanta Intl', State: 'GA', 'IATA Code': 'ATL' };

  expect(await hover({ origin: 'ATL' })).toMatchObject({ matches: 1, tooltip: airport });
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText(airport.Airport);

  // Selecting an origin draws its routes, and every route carries the origin field too.
  const org = 'vacp://vacp-examples/vega-lite/airports/airports/param/org';
  expect((await executeOperation(page, 'vega_lite.set_selection', { ref: org, value: { origin: 'ATL' } })).ok).toBe(
    true,
  );
  const route = await hover({ origin: 'ATL' });
  // Atlanta has 173 routes in the flights data, plus its own airport mark.
  expect(route.matches).toBe(174);
  expect(route.tooltip).toMatchObject({ Origin: 'ATL', Destination: expect.any(String) });
  await expect(tooltip).toContainText('Destination');

  expect(await hover({ origin: 'ATL', airport_state: 'GA' })).toMatchObject({ matches: 1, tooltip: airport });
  await expect(tooltip).toContainText(airport.Airport);
  await expect(tooltip).not.toContainText('Destination');
});
