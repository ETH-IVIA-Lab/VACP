import { expect, test } from '@playwright/test';

import { startAppServer } from '../../helpers/devserver';
import { exampleDir } from '../../helpers/paths';

test('vgplot: explicit restoration apply_state preserves Toggle selection values (Seattle Weather)', async ({
  page,
}) => {
  const srv = await startAppServer({ name: 'vgplot-gallery', cwd: exampleDir('vgplot-gallery') });
  const suspiciousConsole: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();

    if (/Parser Error|\\[object Object\\]/i.test(text)) suspiciousConsole.push(text);
  });
  page.on('pageerror', (err) => {
    const text = String(err?.message ?? err);

    if (/Parser Error|\\[object Object\\]/i.test(text)) suspiciousConsole.push(text);
  });

  try {
    await page.goto(`${srv.url}#weather`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!globalThis.__vacp);

    const overlay = page.locator('#app svg').first().locator('rect.overlay').first();
    await expect(overlay).toBeVisible();
    const box = await overlay.boundingBox();
    expect(box).toBeTruthy();

    if (!box) return;

    const brush = async (fromFrac: number, toFrac: number) => {
      const y = box.y + box.height * 0.5;
      const x0 = box.x + box.width * fromFrac;
      const x1 = box.x + box.width * toFrac;
      await page.mouse.move(x0, y);
      await page.mouse.down();
      await page.mouse.move(x1, y);
      await page.mouse.up();
    };

    await brush(0.15, 0.45);
    await page.waitForFunction(() => {
      const r = document
        .querySelector('#app')
        ?.querySelector('svg')
        ?.querySelector('rect.selection') as SVGRectElement | null;

      if (!r) return false;
      const b = r.getBBox();

      return b.width > 2 && b.height > 2;
    });
    await brush(0.6, 0.9);

    const outcome = await page.evaluate(async () => {
      const b = globalThis.__vacp;
      const current = await b.observe();
      const history = (await b.getRuntime()).history;
      const selected = history.find((entry: any) => entry.observation)?.observation;
      if (!selected) throw new Error('Missing historical observation');
      const action = current.graph.actions.find((action: any) => action.operation.contract === 'vacp.apply_state');
      if (!action) throw new Error('Missing restoration action');
      return b.execute({ callId: 'restore', name: action.name, params: { state: selected.state } });
    });
    expect(outcome.ok).toBe(true);
    // Restoration is explicit. Further human input operates directly on the restored live source.
    await brush(0.25, 0.55);

    await expect
      .poll(async () => {
        return await page.evaluate(async () => {
          const st = await globalThis.__vacp.getState();

          const entries = Object.entries(st.state ?? {}).filter(([, v]) => v && typeof v === 'object' && 'kind' in v);

          const interval = entries.find(([, v]) => (v as any).kind === 'Interval1D')?.[1] as any;
          const a = interval?.value ?? null;
          const b = interval?.selectionValue ?? null;

          const normalize = (value: unknown) => {
            if (value instanceof Date) return value.getTime();

            if (Array.isArray(value)) return value.map(normalize);

            return value;
          };

          return { eq: JSON.stringify(normalize(a)) === JSON.stringify(normalize(b)) };
        });
      })
      .toMatchObject({ eq: true });

    expect(suspiciousConsole).toEqual([]);
  } finally {
    await srv.stop();
  }
});
