import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { stylexShadowSheet } from './shadow-sheet';

const root = new URL('../../packages/presence-browser/src/', import.meta.url).pathname;
const plugin = stylexShadowSheet({ root, id: 'virtual:sheet' });
// The plugin declares plain function hooks; the tests call them as a bundler would.
const load = plugin.load as (this: { addWatchFile(file: string): void }, id: string) => string | undefined;
const transform = plugin.transform as (source: string, id: string) => { code: string } | undefined;
const hooks = { load, transform };
const context = { addWatchFile() {} };

test('every presence style is compiled away, leaving no StyleX call to run in the browser', () => {
  const files = readdirSync(root).filter((name) => /\.tsx?$/.test(name));
  for (const name of files) {
    const source = readFileSync(join(root, name), 'utf8');
    const compiled = hooks.transform(source, join(root, name));
    if (!compiled) continue;
    assert.doesNotMatch(compiled.code, /stylex\.(create|keyframes|when|defineMarker|defineConsts)\b/, name);
  }
});

test('the shadow sheet is complete and identical however often it is built', () => {
  const first = hooks.load.call(context, '\0virtual:sheet')!;
  assert.equal(hooks.load.call(context, '\0virtual:sheet'), first);
  const css = JSON.parse(first.slice('export default '.length, -1)) as string;
  assert.match(css, /^\n?@layer priority1/);
  assert.match(css, /data-reduced/);
});
