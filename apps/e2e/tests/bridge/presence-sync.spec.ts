import { expect, type Page } from '@playwright/test';
import { test } from '../helpers/test';
import { appServer } from '../helpers/servers';
import { settled, tool } from '../helpers/presence';

test.use({
  exampleOptions: { paceAgentSteps: true },
  viewport: { width: 1440, height: 900 },
  launchOptions: { args: ['--enable-experimental-web-platform-features', '--enable-features=WebMCPTesting'] },
});

type Sample = {
  t: number;
  text: string;
  phase: string | undefined;
  cursor: { x: number; y: number };
  bubble: { x: number; y: number; width: number; height: number };
  caret: string;
};
type Sampling = Window & { __vacpSamples?: Sample[] };

/** Record the overlay from inside the page, between frames, until stopped. */
async function sample(page: Page, everyMs: number) {
  await page.evaluate((everyMs) => {
    const samples: Sample[] = [];
    (window as Sampling).__vacpSamples = samples;
    const timer = setInterval(() => {
      const shadow = document.querySelector('[data-vacp-presence]')?.shadowRoot;
      const pointer = shadow?.querySelector<SVGGElement>('g[data-vacp-phase]');
      const bubble = shadow?.querySelector<HTMLElement>('[data-vacp-bubble]');
      if (!pointer || !bubble) return;
      const { e: x, f: y } = pointer.getScreenCTM()!;
      const box = bubble.getBoundingClientRect();
      const tail = bubble.querySelector('[data-vacp-prose] > div > :last-child');
      samples.push({
        t: performance.now(),
        text: bubble.querySelector<HTMLElement>('[data-vacp-summary]')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
        phase: pointer.dataset.vacpPhase,
        cursor: { x: Math.round(x), y: Math.round(y) },
        bubble: {
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
        },
        caret: tail ? getComputedStyle(tail, '::after').width : 'auto',
      });
    }, everyMs);
    window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  }, everyMs);
  return () => page.evaluate(() => (window as Sampling).__vacpSamples ?? []);
}

async function open(page: Page, url: string) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => !!window.__vacp?.beginAgentActivity);
  await expect
    .poll(async () =>
      page.evaluate(async () =>
        ((await document.modelContext?.getTools()) ?? []).some((tool) => tool.name.endsWith('cohort.set_sports')),
      ),
    )
    .toBe(true);
  return errors;
}

const actor = { id: 'webmcp', kind: 'agent', label: 'Analyst' } as const;

test('words about the next step start with the step and ride with the cursor to its target', async ({ page }) => {
  const server = appServer('athlete-explorer');
  const errors = await open(page, server.url);
  await page.evaluate(
    (actor) => (window.__vacpStream = window.__vacp!.beginAgentActivity({ actor, summary: 'Filtering for women.' })),
    actor,
  );
  const summary = page.locator('[data-vacp-summary]');
  const mark = page.locator('[data-vacp-bubble] [data-vacp-mark]');
  await expect(summary).toContainText('Filtering for women.');
  expect((await tool(page, 'cohort.set_sex', { sex: 'female', narration: 'Filtering for women.' })).ok).toBe(true);
  const rest = await settled(page);

  // Between steps the new sentence waits: the last words stay while the busy mark shows.
  const sentence = 'Keeping canoe and rowing so the two paddle sports can be compared.';
  await page.evaluate((text) => window.__vacpStream!.update(text), sentence);
  await page.waitForTimeout(500);
  await expect(summary).toHaveText('Filtering for women.');
  await expect(mark).toHaveAttribute('data-busy', '');

  const samples = await sample(page, 30);
  const fired = await page.evaluate(() => performance.now());
  const step = tool(page, 'cohort.set_sports', { sports: ['canoe', 'rowing'], narration: sentence });
  await expect(summary).toContainText('Keeping', { timeout: 5000 });
  expect((await step).ok).toBe(true);
  await expect(summary).toHaveText(sentence);
  const arrived = await settled(page);
  const recorded = await samples();

  const first = recorded.find((entry) => entry.text.startsWith('Keeping'))!;
  expect(first, 'the sentence appears only once the step is under way').toBeDefined();
  expect(first.t).toBeGreaterThanOrEqual(fired);
  expect(first.phase).toBe('acting');
  expect(recorded.filter((entry) => entry.t < fired).every((entry) => entry.text === 'Filtering for women.')).toBe(
    true,
  );

  // While the cursor travels, the label rides beside it instead of waiting at the destination.
  const away = (entry: Sample, point: { x: number; y: number }) =>
    Math.hypot(entry.cursor.x - point.x, entry.cursor.y - point.y) > 40;
  const flight = recorded.filter((entry) => away(entry, rest.cursor) && away(entry, arrived.cursor));
  expect(flight.length).toBeGreaterThanOrEqual(3);
  const gap = ({ cursor, bubble }: Sample) =>
    Math.hypot(
      Math.max(bubble.x - cursor.x, 0, cursor.x - bubble.x - bubble.width),
      Math.max(bubble.y - cursor.y, 0, cursor.y - bubble.y - bubble.height),
    );
  // The label keeps its offset from the travelling cursor and eases it toward where it will rest.
  for (const entry of flight) expect(gap(entry)).toBeLessThanOrEqual(96);
  expect(new Set(flight.map((entry) => `${entry.bubble.x},${entry.bubble.y}`)).size).toBeGreaterThanOrEqual(3);
  expect(flight.some((entry) => entry.text.startsWith('Keeping'))).toBe(true);
  // At the target the label settles beside the cursor, clear of the step's outline.
  expect(arrived.distance).toBeLessThanOrEqual(48);
  expect(arrived.covered).toBe(0);
  await page.evaluate(() => window.__vacpStream!.end());
  expect(errors).toEqual([]);
});

test('a scroll during travel shifts the flight with the page instead of restarting or cutting it', async ({ page }) => {
  const server = appServer('athlete-explorer');
  await page.setViewportSize({ width: 1440, height: 640 });
  const errors = await open(page, server.url);
  await page.evaluate(
    (actor) => (window.__vacpStream = window.__vacp!.beginAgentActivity({ actor, summary: 'Filtering for women.' })),
    actor,
  );
  expect((await tool(page, 'cohort.set_sex', { sex: 'female', narration: 'Filtering for women.' })).ok).toBe(true);
  await settled(page);
  await page.evaluate(() => window.__vacpStream!.update('Keeping canoe and rowing.'));
  const samples = await sample(page, 30);
  const step = tool(page, 'cohort.set_sports', { sports: ['canoe', 'rowing'], narration: 'Keeping canoe and rowing.' });
  await page.waitForTimeout(110);
  const scrolledAt = await page.evaluate(() => {
    scrollBy(0, 160);
    return performance.now();
  });
  expect((await step).ok).toBe(true);
  const arrived = await settled(page);
  const recorded = await samples();
  // The flight keeps going after the scroll: several later samples still move the cursor.
  const later = recorded.filter((entry) => entry.t > scrolledAt);
  const moving = later.filter(
    (entry, index) =>
      index > 0 &&
      Math.hypot(entry.cursor.x - later[index - 1]!.cursor.x, entry.cursor.y - later[index - 1]!.cursor.y) > 1,
  );
  expect(moving.length).toBeGreaterThanOrEqual(3);
  // It lands on the row where it now is, not where it was before the page moved.
  const row = await page.locator('[data-sport="canoe"]').boundingBox();
  expect(row).not.toBeNull();
  expect(Math.abs(arrived.cursor.y - (row!.y + row!.height / 2))).toBeLessThanOrEqual(3);
  await page.evaluate(() => window.__vacpStream!.end());
  expect(errors).toEqual([]);
});

test('the wait for a step is bounded so a read-only remark still shows', async ({ page }) => {
  const server = appServer('athlete-explorer');
  const errors = await open(page, server.url);
  await page.evaluate(
    (actor) => (window.__vacpStream = window.__vacp!.beginAgentActivity({ actor, summary: 'Filtering for women.' })),
    actor,
  );
  expect((await tool(page, 'cohort.set_sex', { sex: 'female', narration: 'Filtering for women.' })).ok).toBe(true);
  const summary = page.locator('[data-vacp-summary]');
  const started = Date.now();
  await page.evaluate(() => window.__vacpStream!.update('Reading the medal table.'));
  await page.waitForTimeout(800);
  await expect(summary).toHaveText('Filtering for women.');
  await expect(summary).toContainText('Reading the medal table.', { timeout: 4000 });
  expect(Date.now() - started).toBeGreaterThanOrEqual(1800);
  await page.evaluate(() => window.__vacpStream!.end());
  expect(errors).toEqual([]);
});

test('a finished turn hands its words to the retained step without reading them again', async ({ page }) => {
  const server = appServer('athlete-explorer');
  const errors = await open(page, server.url);
  await page.evaluate(
    (actor) => (window.__vacpStream = window.__vacp!.beginAgentActivity({ actor, summary: 'Filtering for women.' })),
    actor,
  );
  expect((await tool(page, 'cohort.set_sex', { sex: 'female', narration: 'Filtering for women.' })).ok).toBe(true);
  await page.evaluate(() => window.__vacpStream!.update('Keeping canoe and rowing.'));
  const sports = { sports: ['canoe', 'rowing'], narration: 'Keeping canoe and rowing.' };
  expect((await tool(page, 'cohort.set_sports', sports)).ok).toBe(true);
  const summary = page.locator('[data-vacp-summary]');
  const closing = 'Female canoeists and rowers are now in view.';
  await page.evaluate((text) => window.__vacpStream!.end({ summary: text }), closing);
  await expect(summary).toHaveText(closing);
  const samples = await sample(page, 40);
  // The live turn lingers, then the recorded trail keeps the same words in the same place.
  await page.waitForTimeout(3600);
  const recorded = await samples();
  expect(recorded.length).toBeGreaterThan(40);
  expect(recorded.every((entry) => entry.text === closing)).toBe(true);
  expect(recorded.every((entry) => entry.caret === 'auto')).toBe(true);
  expect(new Set(recorded.map((entry) => `${entry.bubble.x},${entry.bubble.y}`)).size).toBe(1);
  await expect(page.locator('[data-vacp-bubble]')).toHaveCount(1);
  await expect(page.locator('[data-vacp-bubble] [data-vacp-mark][data-busy]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
