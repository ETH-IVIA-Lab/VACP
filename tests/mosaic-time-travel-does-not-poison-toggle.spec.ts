import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { startViteDevServer } from './helpers/devserver';

const here = dirname(fileURLToPath(import.meta.url));
const vacpRoot = resolve(here, '..');
const examplesDir = resolve(vacpRoot, 'packages', 'examples');

test('mosaic: time travel apply_state does not poison Toggle selection (Seattle Weather)', async ({ page }) => {
  const srv = await startViteDevServer({ name: 'mosaic-gallery', cwd: resolve(examplesDir, 'mosaic-gallery') });
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
    await page.goto(`${srv.url}?vacp-debug=1#weather`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(globalThis as any).__vacp);

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

    const prevCursor = await page.evaluate(async () => {
      const b = (globalThis as any).__vacp;
      const rt = await b.getRuntime();
      const stateFromEntry = (entry: any) => entry?.state ?? entry?.afterState ?? entry?.beforeState ?? null;
      const findPrevIndexWithState = (history: any[], startIdx: number): number | null => {
        for (let i = Math.min(startIdx, history.length - 1); i >= 0; i--) {
          if (stateFromEntry(history[i])) return i;
        }
        return null;
      };
      // Choose a prior stateful history entry to force a replay.
      const cursor = Number.isFinite(rt.cursor) ? rt.cursor : rt.history.length - 1;
      return findPrevIndexWithState(rt.history, cursor - 1) ?? Math.max(0, cursor - 1);
    });

    await page.evaluate(
      ({ idx }) => {
        const b = (globalThis as any).__vacp;
        b.setCursor?.(idx, { source: 'debug', message: `cursor=${idx}` });
      },
      { idx: prevCursor },
    );

    await expect
      .poll(async () => {
        return await page.evaluate(async () => {
          const b = (globalThis as any).__vacp;
          const rt = await b.getRuntime();
          const st = await b.getState();
          const hasPlainObject = (value: unknown): boolean => {
            if (value == null) return false;
            if (value instanceof Date) return false;
            if (Array.isArray(value)) return value.some((v) => hasPlainObject(v));
            return typeof value === 'object';
          };
          const entries = Object.entries(st.state ?? {}).filter(
            ([, v]) => v && typeof v === 'object' && 'kind' in (v as any),
          );
          const toggle = entries.find(([, v]) => (v as any).kind === 'Toggle')?.[1] as any;
          const bad = hasPlainObject(toggle?.value) || hasPlainObject(toggle?.selectionValue);
          return { mode: rt.mode, cursor: rt.cursor, bad };
        });
      })
      .toMatchObject({ mode: 'inspect', cursor: prevCursor, bad: false });

    // Return to live and ensure subsequent brushing remains functional.
    await page.evaluate(() => {
      const b = (globalThis as any).__vacp;
      b.setMode?.('live', { source: 'debug', message: 'mode=live' });
    });
    await brush(0.25, 0.55);

    await expect
      .poll(async () => {
        return await page.evaluate(async () => {
          const st = await (globalThis as any).__vacp.getState();
          const entries = Object.entries(st.state ?? {}).filter(
            ([, v]) => v && typeof v === 'object' && 'kind' in (v as any),
          );
          const interval = entries.find(([, v]) => (v as any).kind === 'Interval1D')?.[1] as any;
          const a = interval?.value ?? null;
          const b = interval?.selectionValue ?? null;
          const normalize = (value: unknown): unknown => {
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
