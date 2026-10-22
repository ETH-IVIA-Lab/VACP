import { expect } from '@playwright/test';
import { test } from '../../helpers/test';

import { gotoApp } from '../../helpers/servers';
import { executeOperation } from '../operations';

test('cars brush parameters describe partial dimensions and normalize ranges before execution', async ({ page }) => {
  await gotoApp(page, 'cars-parallel-coords');
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
      name: action.name,
      params: { ranges: { Horsepower: ['150', '100'] } },
    });
    const selected = rows()
      .filter((row) => row.visible)
      .map((row) => row.id);
    const invalid = await bridge.execute({
      name: action.name,
      params: { ranges: { NotADimension: [0, 1] } },
    });
    const afterInvalid = rows()
      .filter((row) => row.visible)
      .map((row) => row.id);
    const cleared = await bridge.execute({
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

test('cars restoration applies projected brushes and an explicit null hover, and rejects malformed state before any effect', async ({
  page,
}) => {
  await gotoApp(page, 'cars-parallel-coords');
  const base = 'vacp://vacp-examples/vanilla/cars-parallel-coords/parallel-coords';
  const brushRef = `${base}/selection/brushes`;
  const orderRef = `${base}/param/dimension_order`;
  const hoverRef = `${base}/selection/hover`;
  const execute = (name: string, params: Record<string, unknown>) =>
    page.evaluate(({ name, params }) => globalThis.__vacp!.execute({ name, params }), {
      name,
      params,
    });
  const read = () => page.evaluate(async () => (await globalThis.__vacp!.observe()).state as Record<string, any>);
  const initial = await read();

  // A car inside the restored brush, so only the explicit null can clear its hover.
  const id = await page.evaluate(
    () =>
      Array.from(document.querySelectorAll('#chart .line'), (path) => {
        const row = (path as SVGPathElement & { __data__: { id: number; Horsepower: number } }).__data__;
        return row;
      }).find((row) => row.Horsepower > 110 && row.Horsepower < 140)!.id,
  );
  expect((await execute('parallel_coords.set_hover', { id })).ok).toBe(true);
  expect((await read())[hoverRef].hoveredId).toBe(id);

  const ranges = { ...initial[brushRef].ranges, Horsepower: [100, 150] };
  const restored = await executeOperation(page, 'vacp.apply_state', {
    state: { [brushRef]: { ranges }, [hoverRef]: { hoveredId: null } },
  });
  expect(restored.ok).toBe(true);
  const afterRestore = await read();
  expect(afterRestore[brushRef].ranges.Horsepower).toEqual([100, 150]);
  expect(afterRestore[brushRef].selectedCount).toBeLessThan(initial[brushRef].totalCount);
  expect(afterRestore[hoverRef].hoveredId).toBeNull();

  const reversed = [...initial[orderRef].value].reverse();
  const malformed = await executeOperation(page, 'vacp.apply_state', {
    state: { [orderRef]: { value: reversed }, [brushRef]: { ranges: { ...ranges, MPG: [40, 10] } } },
  });
  expect(malformed.ok).toBe(false);
  const afterMalformed = await read();
  expect(afterMalformed[orderRef].value).toEqual(initial[orderRef].value);
  expect(afterMalformed[brushRef].ranges).toEqual(afterRestore[brushRef].ranges);
});
