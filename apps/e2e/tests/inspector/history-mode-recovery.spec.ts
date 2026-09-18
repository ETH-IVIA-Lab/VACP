import { expect, test } from '@playwright/test';

import { startAppServer } from '../helpers/devserver';
import { exampleDir } from '../helpers/paths';
import { inspectorRuntimeState, waitForRuntimeMode, waitForVacpBridge } from './helpers';

test('inspector: history mode strip inspects selected state and returns to live', async ({ page }) => {
  const srv = await startAppServer({
    name: 'vgplot-gallery',
    cwd: exampleDir('vgplot-gallery'),
  });

  try {
    await page.goto(`${srv.url}?vacp-inspector=1#weather`, { waitUntil: 'domcontentloaded' });
    await waitForVacpBridge(page);

    await page.evaluate(async () => {
      const bridge = globalThis.__vacp;
      await bridge.refresh({ source: 'inspector', message: 'history-mode-recovery-0' });
      await bridge.refresh({ source: 'inspector', message: 'history-mode-recovery-1' });
    });

    const pill = page.locator('button.vacp-inspector-button');
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.locator('#vacp-inspector-panel')).toBeVisible();

    await page.getByRole('tab', { name: 'History' }).click();
    const modeStrip = page.locator('[data-vacp-history-mode-strip="1"]');
    await expect(modeStrip).toContainText('Live mode');

    const stateEntry = page.locator('[data-vacp-row="history-entry"][data-has-state="true"]').first();
    await expect(stateEntry).toBeVisible({ timeout: 15_000 });
    const targetIdx = Number(await stateEntry.getAttribute('data-index'));
    expect(Number.isFinite(targetIdx)).toBe(true);

    await stateEntry.click();
    await page.getByRole('button', { name: 'Inspect selected' }).click();
    await waitForRuntimeMode(page, 'inspect');
    await expect
      .poll(async () => await inspectorRuntimeState(page))
      .toMatchObject({ mode: 'inspect', cursor: targetIdx });
    await expect(modeStrip).toContainText(`Inspecting history entry ${targetIdx}`);

    await page.getByRole('button', { name: 'Return to Live' }).click();
    await waitForRuntimeMode(page, 'live');
    await expect(modeStrip).toContainText('Live mode');
    await expect.poll(async () => (await inspectorRuntimeState(page)).mode).toBe('live');
  } finally {
    await srv.stop();
  }
});

test('inspector: returning to live reapplies the latest host state after inspect replay', async ({ page }) => {
  const srv = await startAppServer({
    name: 'vgplot-gallery',
    cwd: exampleDir('vgplot-gallery'),
  });

  try {
    await page.goto(`${srv.url}?vacp-inspector=1#aeromagnetic-survey`, { waitUntil: 'domcontentloaded' });
    await waitForVacpBridge(page, { requireRuntime: true });

    const { targetRef, oldValue, liveValue } = await page.evaluate(async () => {
      const bridge = globalThis.__vacp;
      await bridge.refresh({ source: 'inspector', message: 'history-live-replay-baseline' });
      const before = await bridge.getState();
      const widgetEntry = Object.entries(before.state).find(([, value]) => (value as any)?.kind === 'Widget');

      if (!widgetEntry) throw new Error('No widget state found');
      const [targetRef, widget] = widgetEntry;
      if (!widget || typeof widget !== 'object' || !('value' in widget)) throw new Error('Invalid widget state');

      const action = (await bridge.getCapabilities()).graph.actions.find(
        (candidate: any) => candidate.name === 'vgplot.set_input_option_index',
      );

      const params = structuredClone(action?.parameters?.default ?? { ref: targetRef, index: 0 });
      params.ref = targetRef;

      await bridge.dispatch(
        {
          callId: crypto.randomUUID(),
          name: 'vgplot.set_input_option_index',
          params,
        },
        { source: 'inspector', message: 'history-live-replay-action' },
      );
      let live = await bridge.getState();

      if ((live.state as any)[targetRef]?.value === (widget as any).value && Number((widget as any).optionCount) > 1) {
        params.index = params.index === 0 ? 1 : 0;
        await bridge.dispatch(
          {
            callId: crypto.randomUUID(),
            name: 'vgplot.set_input_option_index',
            params,
          },
          { source: 'inspector', message: 'history-live-replay-action-alt' },
        );
        live = await bridge.getState();
      }

      return {
        targetRef,
        oldValue: (widget as any).value,
        liveValue: (live.state as any)[targetRef]?.value,
      };
    });

    expect(liveValue).not.toEqual(oldValue);

    const pill = page.locator('button.vacp-inspector-button');
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(page.locator('#vacp-inspector-panel')).toBeVisible();

    await page.getByRole('tab', { name: 'History' }).click();
    const firstStateEntry = page.locator('[data-vacp-row="history-entry"][data-has-state="true"]').first();
    await firstStateEntry.click();
    await page.getByRole('button', { name: 'Inspect selected' }).click();
    await waitForRuntimeMode(page, 'inspect');
    await expect
      .poll(async () => {
        const snap = await page.evaluate(async (ref) => {
          const bridge = globalThis.__vacp;

          return (await bridge.getState()).state[ref]?.value;
        }, targetRef);

        return snap;
      })
      .toEqual(oldValue);

    await page.getByRole('button', { name: 'Return to Live' }).click();
    await waitForRuntimeMode(page, 'live');
    await expect
      .poll(async () => {
        const snap = await page.evaluate(async (ref) => {
          const bridge = globalThis.__vacp;

          return (await bridge.getState()).state[ref]?.value;
        }, targetRef);

        return snap;
      })
      .toEqual(liveValue);
  } finally {
    await srv.stop();
  }
});

test('inspector: returning to live does not apply inspect-only JSON overrides', async ({ page }) => {
  const srv = await startAppServer({
    name: 'vgplot-gallery',
    cwd: exampleDir('vgplot-gallery'),
  });

  try {
    await page.goto(`${srv.url}?vacp-inspector=1#aeromagnetic-survey`, { waitUntil: 'domcontentloaded' });
    await waitForVacpBridge(page, { requireRuntime: true });

    const setup = await page.evaluate(async () => {
      const bridge = globalThis.__vacp;
      await bridge.refresh({ source: 'inspector', message: 'history-override-live-baseline' });
      const before = await bridge.getState();
      const widgetEntry = Object.entries(before.state).find(([, value]) => (value as any)?.kind === 'Widget');

      if (!widgetEntry) throw new Error('No widget state found');
      const [targetRef, widget] = widgetEntry;
      if (!widget || typeof widget !== 'object' || !('value' in widget)) throw new Error('Invalid widget state');

      const optionsResult = await bridge.execute({
        callId: crypto.randomUUID(),
        name: 'vacp.widget_options',
        params: { ref: targetRef, limit: 20 },
      });

      const overrideValue = (optionsResult?.result?.options ?? [])
        .map((option: any) => option.value)
        .find((value: unknown) => value !== widget.value);

      if (overrideValue === undefined) throw new Error('No alternate widget value found');

      const overrideState = structuredClone(before.state);
      overrideState[targetRef] = {
        ...overrideState[targetRef],
        value: overrideValue,
        selectionValue: overrideValue,
      };
      bridge.setStateOverride(overrideState, { source: 'inspector', message: 'inspect-only override' });

      return {
        targetRef,
        liveValue: widget.value,
        overrideValue,
      };
    });

    expect(setup.overrideValue).not.toEqual(setup.liveValue);

    await waitForRuntimeMode(page, 'inspect');
    await expect
      .poll(async () => {
        const current = await page.evaluate(async (ref) => {
          const bridge = globalThis.__vacp;
          const runtime = await bridge.getRuntime();
          const live = (await bridge.getState()).state[ref]?.value;

          return {
            current: runtime.currentState.state[ref]?.value,
            live,
          };
        }, setup.targetRef);

        return current;
      })
      .toMatchObject({ current: setup.overrideValue, live: setup.liveValue });

    await page.evaluate(() => {
      globalThis.__vacp.setMode('live', { source: 'inspector', message: 'return after override' });
    });
    await waitForRuntimeMode(page, 'live');
    await expect
      .poll(async () => {
        return await page.evaluate(async (ref) => {
          const bridge = globalThis.__vacp;

          return (await bridge.getState()).state[ref]?.value;
        }, setup.targetRef);
      })
      .toEqual(setup.liveValue);
  } finally {
    await srv.stop();
  }
});
