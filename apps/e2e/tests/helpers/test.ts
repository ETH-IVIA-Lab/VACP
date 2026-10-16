import { test as base } from '@playwright/test';
import type { ExampleOptions } from '@vacp/example-shared/config';

/**
 * Examples pace agent steps so a person can follow them. Wiring tests run unpaced; presence specs
 * restore pacing with `test.use({ exampleOptions: { paceAgentSteps: true } })`. Pages opened with
 * `browser.newPage()` keep the examples' own defaults.
 */
export const test = base.extend<{ exampleOptions: Partial<ExampleOptions> }>({
  exampleOptions: [{ paceAgentSteps: false }, { option: true }],
  page: async ({ page, exampleOptions }, use) => {
    // Runs before a spec's own init scripts, which extend these options.
    await page.addInitScript((options) => {
      globalThis.__vacpExampleOptions = options;
    }, exampleOptions);
    await use(page);
  },
});
