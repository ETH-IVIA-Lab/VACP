import { expect } from '@playwright/test';
import { test } from '../helpers/test';
import { repoRoot } from '../helpers/paths';
import { appServer } from '../helpers/servers';

test('the ref resolver matches the exact ref in its attribute and points at the first placeable match under its root', async ({
  page,
}) => {
  await page.goto(appServer('vega-lite-gallery').url);
  const result = await page.evaluate(async (rootPath) => {
    const { createRefPresenceResolver }: typeof import('@ethivia/vacp-presence/dom') = await import(
      `/@fs${rootPath}/packages/presence-core/src/dom.ts`
    );
    const first = 'vacp://items/first';
    const quoted = 'vacp://items/say "hi" \\ [now]';
    const outside = document.createElement('button');
    outside.setAttribute('data-vacp-ref', first);
    const root = document.createElement('section');
    root.innerHTML = `
      <script type="application/json">{}</script>
      <template><button>First</button></template>
      <button hidden>First</button>
      <button style="visibility:hidden">First</button>
      <button style="width:0;height:0;padding:0;border:0"></button>
      <button id="child">Child</button>
      <button id="first">First</button>
      <button id="again">First again</button>
      <button id="quoted">Quoted</button>
      <button id="item" data-item="vacp://items/second">Second</button>`;
    for (const element of root.querySelectorAll(':not(#child, #quoted, #item)'))
      element.setAttribute('data-vacp-ref', first);
    root.querySelector('#child')!.setAttribute('data-vacp-ref', `${first}/child`);
    root.querySelector('#quoted')!.setAttribute('data-vacp-ref', quoted);
    document.body.prepend(outside, root);
    const options = { signal: new AbortController().signal };
    const box = (selector: string) => {
      const { x, y, width, height } = root.querySelector(selector)!.getBoundingClientRect();
      return { kind: 'region', x, y, width, height };
    };
    try {
      const marked = createRefPresenceResolver(root);
      const items = createRefPresenceResolver(root, 'data-item');
      return {
        first: { actual: await marked({ ref: first }, options), expected: box('#first') },
        quoted: { actual: await marked({ ref: quoted }, options), expected: box('#quoted') },
        item: { actual: await items({ ref: 'vacp://items/second' }, options), expected: box('#item') },
        unmarked: await marked({ ref: 'vacp://items/second' }, options),
      };
    } finally {
      outside.remove();
      root.remove();
    }
  }, repoRoot);
  for (const name of ['first', 'quoted', 'item'] as const)
    expect(result[name].actual, name).toEqual({
      surface: 'viewport',
      precision: 'surface',
      geometry: result[name].expected,
    });
  expect(result.unmarked).toBeNull();
});

test('presence reports the step whose ref nothing marks once it leaves, and places the marked one below the viewport', async ({
  page,
}) => {
  await page.goto(appServer('vega-lite-gallery').url);
  const result = await page.evaluate(async (rootPath) => {
    const { presentMarkedSteps }: typeof import('../../fixtures/presence') = await import(
      `/@fs${rootPath}/apps/e2e/fixtures/presence.ts`
    );
    return presentMarkedSteps();
  }, repoRoot);
  expect(result.shown).toEqual([]);
  expect(result.unplaced).toEqual(['label.set']);
  expect(result.placed).toEqual({ surface: 'viewport', precision: 'surface', geometry: result.threshold });
  expect(result.threshold.y).toBeGreaterThan(result.viewportHeight);
});
