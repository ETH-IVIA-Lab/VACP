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

test('the bubble and the trail speak the labels the host supplies', async ({ page }) => {
  await gotoApp(page, 'vega-lite-gallery');
  await page.evaluate(async (root) => {
    const { showRecordedStep } = await import(`/@fs${root}/apps/e2e/fixtures/presence.ts`);
    showRecordedStep(
      {
        start: 'Anfang',
        step: (position: number, count: number) => `Schritt ${position} von ${count}`,
        conclusion: 'Ergebnis',
        agent: 'Assistenz',
        trail: 'Verlauf der Anfrage',
        stepper: 'Verlauf durchgehen',
        back: 'Vorheriger Schritt',
        forward: 'Nächster Schritt',
        live: 'Zurück zur aktuellen Ansicht',
        diverged: 'Die Ansicht kann leicht von der Aufzeichnung abweichen.',
        updated: (subject = 'Ansicht') => `${subject} aktualisiert`,
      },
      { reviewing: true, working: false },
    );
  }, repoRoot);
  const overlay = page.locator('[data-vacp-presence]').last();
  const bubble = overlay.locator('[data-vacp-bubble]');
  await expect(bubble.locator('[data-vacp-heading]')).toHaveText('Schritt 1 von 2');
  await expect(bubble.locator('[data-vacp-summary]')).toHaveText('Ansicht aktualisiert');
  await expect(bubble.locator('[data-vacp-note]')).toHaveText(
    'Die Ansicht kann leicht von der Aufzeichnung abweichen.',
  );
  await expect(bubble).toMatchAriaSnapshot(`
    - group "Verlauf der Anfrage":
      - button "Anfang"
      - button "Schritt 1 von 2"
      - button "Schritt 2 von 2"
      - button "Ergebnis"
    - navigation "Verlauf durchgehen":
      - button "Vorheriger Schritt"
      - button "Nächster Schritt"
      - button "Zurück zur aktuellen Ansicht"
  `);
  await expect(overlay.getByRole('status')).toHaveText('Assistenz: Ansicht aktualisiert');
});

test('a partial set of labels replaces only its own words while the agent works', async ({ page }) => {
  await gotoApp(page, 'vega-lite-gallery');
  await page.evaluate(async (root) => {
    const { showRecordedStep } = await import(`/@fs${root}/apps/e2e/fixtures/presence.ts`);
    showRecordedStep(
      { dismiss: 'Schließen', working: 'Weiter, sobald die Assistenz fertig ist' },
      { reviewing: false, working: true },
    );
  }, repoRoot);
  const bubble = page.locator('[data-vacp-presence]').last().locator('[data-vacp-bubble]');
  await expect(bubble.getByRole('button', { name: 'Previous step', exact: true })).toHaveAttribute(
    'title',
    'Weiter, sobald die Assistenz fertig ist',
  );
  await expect(bubble.getByRole('button', { name: 'Start', exact: true })).toHaveAttribute(
    'title',
    'Weiter, sobald die Assistenz fertig ist',
  );
  await expect(bubble).toMatchAriaSnapshot(`
    - group "Request trail":
      - button "Start"
      - button "Step 1 of 2"
      - button "Step 2 of 2"
      - button "Conclusion"
    - navigation "Trail controls":
      - button "Previous step"
      - button "Next step"
      - button "Schließen"
  `);
  await expect(bubble.locator('[data-vacp-note]')).toHaveText('The view may differ slightly from the recording.');
});
