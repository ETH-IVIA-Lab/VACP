import { expect } from '@playwright/test';
import { test } from '../../helpers/test';

import { appServer } from '../../helpers/servers';

test('cars brush parameters describe partial dimensions and normalize ranges before execution', async ({ page }) => {
  const server = appServer('cars-parallel-coords');
  await page.goto(server.url);
  await page.waitForFunction(() => !!globalThis.__vacp);
  const result = await page.evaluate(async () => {
    const bridge = globalThis.__vacp;
    const graph = (await bridge.getCapabilities()).graph;
    const action = graph.actions.find((action) => action.name === 'parallel_coords.set_brush_ranges')!;
    const rows = () =>
      Array.from(document.querySelectorAll<SVGPathElement>('#chart .line')).map((path) => {
        const row = (path as SVGPathElement & { __data__: { id: number; Horsepower: number } }).__data__;
        return { id: row.id, horsepower: row.Horsepower, visible: Number(getComputedStyle(path).opacity) > 0 };
      });
    const expected = rows()
      .filter((row) => row.horsepower >= 100 && row.horsepower <= 150)
      .map((row) => row.id);
    const valid = await bridge.execute({
      callId: 'partial-brush',
      name: action.name,
      params: { ranges: { Horsepower: ['150', '100'] } },
    });
    const selected = rows()
      .filter((row) => row.visible)
      .map((row) => row.id);
    const invalid = await bridge.execute({
      callId: 'unknown-dimension',
      name: action.name,
      params: { ranges: { NotADimension: [0, 1] } },
    });
    const afterInvalid = rows()
      .filter((row) => row.visible)
      .map((row) => row.id);
    const cleared = await bridge.execute({
      callId: 'clear-dimension',
      name: action.name,
      params: { ranges: { Horsepower: null } },
    });
    return { parameters: action.parameters, valid, expected, selected, invalid, afterInvalid, cleared, rows: rows() };
  });
  expect(result.parameters).toMatchObject({
    type: 'object',
    properties: { ranges: { type: 'object', propertyNames: { enum: expect.arrayContaining(['Horsepower']) } } },
  });
  expect(result.valid.ok).toBe(true);
  expect(result.expected.length).toBeGreaterThan(0);
  expect(result.selected).toEqual(result.expected);
  expect(result.invalid.ok).toBe(false);
  expect(result.afterInvalid).toEqual(result.selected);
  expect(result.cleared.ok).toBe(true);
  expect(result.rows.every((row) => row.visible)).toBe(true);
});
