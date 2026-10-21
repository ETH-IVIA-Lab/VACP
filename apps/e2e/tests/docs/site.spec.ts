import { expect } from '@playwright/test';
import { micromark } from 'micromark';
import { test } from '../helpers/test';
import { appServer } from '../helpers/servers';

test('documentation serves the integration guide with its executable example and reaches the reference', async ({
  page,
}, testInfo) => {
  const server = appServer('docs');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${server.url}integrate/`);
  await expect(page.locator('.vp-doc h1')).toHaveText('Connect an application');
  await expect(page.locator('.vp-doc')).toContainText('connectThreshold');
  await expect(page.locator('.vp-doc')).toContainText("from '@ethivia/vacp-sdk'");
  await page.getByRole('link', { name: 'API reference', exact: true }).first().click();
  await page.getByRole('link', { name: '@ethivia/vacp-browser', exact: true }).first().click();
  await expect(page.locator('.vp-doc h1')).toHaveText('@ethivia/vacp-browser');
  await expect(page.locator('.vp-doc')).toContainText('installVacpRuntime');
  await page.screenshot({ path: testInfo.outputPath('runtime-browser-reference.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('llms.txt indexes the guide as Markdown views whose links reach views and files', async ({ request }) => {
  const server = appServer('docs');
  const origin = new URL(server.url).origin;
  const read = async (url: string) => {
    const response = await request.get(url);
    expect(response.status(), url).toBe(200);
    return response;
  };
  // micromark writes `&` in attributes as `&amp;` and percent-encodes the other characters HTML escapes.
  const links = (markdown: string, base: string) =>
    [...micromark(markdown).matchAll(/ (?:href|src)="([^"]*)"/g)].map(
      ([, href = '']) => new URL(href.replaceAll('&amp;', '&'), base),
    );
  const index = new URL('llms.txt', server.url).href;
  const views = links(await (await read(index)).text(), index);
  const bundleUrl = new URL('llms-full.txt', server.url).href;
  const bundle = await (await read(bundleUrl)).text();
  const documents = [{ url: bundleUrl, markdown: bundle }];
  const titles: string[] = [];
  for (const view of views) {
    expect(view.origin, view.href).toBe(origin);
    expect(view.pathname, view.href).toMatch(/\.md$/);
    const response = await read(view.href);
    expect(response.headers()['content-type'], view.href).not.toContain('text/html');
    const markdown = await response.text();
    const title = /^# (.+)$/m.exec(markdown)?.[1] ?? '';
    expect(bundle, view.href).toContain(`\n# ${title}\n`);
    titles.push(title);
    documents.push({ url: view.href, markdown });
  }
  expect(titles).toEqual(
    expect.arrayContaining([
      'What is VACP?',
      'Get started',
      'Connect an application',
      'Connect an agent',
      '@ethivia/vacp-sdk',
    ]),
  );
  const targets = new Set<string>();
  for (const { url, markdown } of documents) {
    for (const target of links(markdown, url)) {
      target.hash = '';
      if (target.origin === origin) targets.add(target.href);
    }
  }
  for (const target of targets) {
    const response = await read(target);
    // The home page has no Markdown view, so links to it keep its HTML route.
    if (target !== server.url) expect(response.headers()['content-type'], target).not.toContain('text/html');
  }
});

test('the overview renders its architecture diagram', async ({ page }) => {
  const server = appServer('docs');
  await page.goto(`${server.url}what-is-vacp/`);
  const diagram = page.getByRole('img', { name: 'VACP architecture' });
  await expect(diagram).toBeVisible();
  await expect(diagram).toContainText('@ethivia/vacp-runtime');
});
