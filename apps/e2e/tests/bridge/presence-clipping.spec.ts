import { expect } from '@playwright/test';
import { test } from '../helpers/test';
import { repoRoot } from '../helpers/paths';
import { appServer } from '../helpers/servers';

test('presence clips shadow content in scaled scroll containers and shares that policy with Vega canvas', async ({
  page,
}) => {
  const server = appServer('vega-lite-gallery');
  await page.goto(server.url);
  const result = await page.evaluate(async (rootPath) => {
    const { elementPresenceTarget }: typeof import('@ethivia/vacp-presence/dom') = await import(
      `/@fs${rootPath}/packages/presence-core/src/dom.ts`
    );
    const { mountPresenceChart }: typeof import('../../fixtures/presence') = await import(
      `/@fs${rootPath}/apps/e2e/fixtures/presence.ts`
    );
    const rect = (element: Element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const host = document.createElement('div');
    host.style.cssText =
      'box-sizing:content-box;position:fixed;left:80px;top:240px;width:200px;height:120px;overflow:hidden;border:8px solid black;transform:scale(1.5);transform-origin:top left';
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML =
      '<div style="position:relative;width:400px;height:400px"><div id="target" style="position:absolute;left:150px;top:90px;width:100px;height:60px"></div><div id="witness" style="position:absolute;left:150px;top:90px;width:50px;height:30px"></div></div>';
    const target = shadow.querySelector('#target')!;
    const partial = {
      actual: elementPresenceTarget(target, 'exact'),
      expected: rect(shadow.querySelector('#witness')!),
    };
    host.scrollTop = 180;
    const hidden = { target: elementPresenceTarget(target, 'exact'), original: rect(target) };
    host.remove();

    const clipping = document.createElement('div');
    clipping.style.cssText =
      'box-sizing:content-box;position:fixed;left:80px;top:100px;width:250px;height:160px;overflow:hidden;border:7px solid black;transform:scale(.8);transform-origin:top left';
    document.body.append(clipping);
    const scoped = clipping.attachShadow({ mode: 'open' });
    const root = document.createElement('div');
    root.style.width = '460px';
    const witness = document.createElement('div');
    witness.style.cssText = 'position:absolute;left:0;top:0;width:250px;height:160px;pointer-events:none';
    scoped.append(root, witness);
    const measure = async (renderer: 'svg' | 'canvas') => {
      const chart = await mountPresenceChart(root, renderer);
      try {
        await chart.filter();
        // The overlay renders the cue after target resolution, a frame or more after the step.
        const deadline = performance.now() + 10_000;
        let cue: SVGPathElement | null | undefined;
        while (cue?.dataset.precision !== 'region' && performance.now() < deadline) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const overlay = [...document.querySelectorAll('[data-vacp-presence]')].at(-1);
          cue = overlay?.shadowRoot?.querySelector<SVGPathElement>('path[data-precision]');
        }
        if (!cue) throw new Error(`The ${renderer} presence cue did not render`);
        const brush = root.querySelector('.brush_brush_bg path');
        return { cue: rect(cue), precision: cue.dataset.precision, brush: brush ? rect(brush) : null };
      } finally {
        chart.dispose();
        root.replaceChildren();
      }
    };
    try {
      const viewport = rect(witness);
      return { partial, hidden, viewport, svg: await measure('svg'), canvas: await measure('canvas') };
    } finally {
      clipping.remove();
    }
  }, repoRoot);
  expect(result.partial.actual).toMatchObject({ precision: 'region', geometry: { kind: 'region' } });
  for (const key of ['x', 'y', 'width', 'height'] as const)
    expect(
      (result.partial.actual!.geometry as { x: number; y: number; width: number; height: number })[key],
    ).toBeCloseTo(result.partial.expected[key], 1);
  expect(result.hidden.original.y).toBeGreaterThan(0);
  expect(result.hidden.target).toBeNull();
  expect(result.svg.brush).not.toBeNull();
  const brush = result.svg.brush!;
  const port = result.viewport;
  const expected = {
    x: Math.max(brush.x, port.x),
    y: Math.max(brush.y, port.y),
    width: Math.min(brush.x + brush.width, port.x + port.width) - Math.max(brush.x, port.x),
    height: Math.min(brush.y + brush.height, port.y + port.height) - Math.max(brush.y, port.y),
  };
  for (const rendering of [result.svg, result.canvas]) {
    expect(rendering.precision).toBe('region');
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(rendering.cue[key]).toBeCloseTo(expected[key], 0);
  }
});
