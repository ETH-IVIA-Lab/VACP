import { expect } from '@playwright/test';
import { test } from '../../helpers/test';
import { appServer } from '../../helpers/servers';

test('explicit apply_state restores a recorded interval brush and later human brushing still applies', async ({
  page,
}) => {
  const srv = appServer('vgplot-gallery');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${srv.url}#weather`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!globalThis.__vacp);

  const overlay = page.locator('#app svg').first().locator('rect.overlay').first();
  await expect(overlay).toBeVisible();
  const box = (await overlay.boundingBox())!;
  const brush = async (fromFrac: number, toFrac: number) => {
    const y = box.y + box.height * 0.5;
    await page.mouse.move(box.x + box.width * fromFrac, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * toFrac, y);
    await page.mouse.up();
  };
  const selection = page.locator('#app svg').first().locator('rect.selection').first();
  const painted = async () => {
    const x = Number(await selection.getAttribute('x'));
    const width = Number(await selection.getAttribute('width'));
    return { x, width };
  };
  // The brush is recorded in data values; projecting them back to pixels may round by a pixel.
  const near = async () => {
    const now = await painted();
    return Math.abs(now.x - recorded.x) <= 1 && Math.abs(now.width - recorded.width) <= 1;
  };

  await brush(0.15, 0.45);
  await expect.poll(async () => (await painted()).width).toBeGreaterThan(2);
  const recorded = await painted();
  await page.evaluate(() =>
    globalThis.__vacp.refresh!({ actor: { id: 'human', kind: 'human' }, message: 'First brush' }),
  );
  await brush(0.6, 0.9);
  await expect.poll(near).toBe(false);

  const outcome = await page.evaluate(async () => {
    const b = globalThis.__vacp;
    const current = await b.observe();
    const entry = (await b.getProvenance()).records.find(
      (record) => record.kind === 'observation' && record.message === 'First brush',
    );
    if (entry?.kind !== 'observation') throw new Error('Missing recorded observation');
    const action = current.graph.actions.find((action: any) => action.operation.contract === 'vacp.apply_state');
    if (!action) throw new Error('Missing restoration action');
    return b.execute({ callId: 'restore', name: action.name, params: { state: entry.observation.state } });
  });
  expect(outcome.ok).toBe(true);
  await expect.poll(near).toBe(true);

  // Restoration is explicit; human input then operates directly on the restored native brush.
  await brush(0.25, 0.55);
  await expect.poll(near).toBe(false);
  const native = await page.evaluate(() => {
    const host = [...document.querySelectorAll('#app *')].find((element) => {
      const value = (element as Element & { value?: { interactors?: unknown[] } }).value;
      return Array.isArray(value?.interactors);
    }) as Element & { value: import('@vacp/adapter-vgplot').VgplotPlotLike };
    const interactor = host.value.interactors[0]!;
    return { brush: interactor.value, clause: interactor.selection!.valueFor!(interactor) };
  });
  expect(native.brush).toEqual(native.clause);
  expect(errors).toEqual([]);
});
