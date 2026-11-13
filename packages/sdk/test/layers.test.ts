import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Each layer of the core may import only the layers listed for it. Protocol stays independent of
// everything, and the browser, presence, and agent layers stay out of protocol and runtime.
const layers: Record<string, readonly string[]> = {
  protocol: [],
  runtime: ['protocol'],
  data: ['protocol'],
  provenance: ['protocol'],
  bridge: ['protocol'],
  webmcp: ['protocol'],
  inspector: ['protocol'],
  presence: ['protocol', 'provenance'],
  browser: ['protocol', 'runtime'],
  actions: ['protocol', 'runtime'],
};

const src = fileURLToPath(new URL('../src/', import.meta.url));
const layerOf = (file: string) => relative(src, file).split(sep)[0] ?? '';

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (/\.tsx?$/.test(entry.name)) yield path;
  }
}

test('core layers import only the layers inward of them', () => {
  const violations: string[] = [];
  for (const file of sources(src)) {
    const layer = layerOf(file);
    if (layer === 'entries') continue;
    const allowed = layers[layer];
    assert.ok(allowed, `${relative(src, file)} sits in a layer missing from the table`);
    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*\(?\s*'(\.[^']*)'/g)) {
      const target = layerOf(resolve(dirname(file), specifier ?? ''));
      if (target !== layer && !allowed.includes(target))
        violations.push(`${relative(src, file)} imports ${target} through '${specifier}'`);
    }
  }
  assert.deepEqual(violations, []);
});
