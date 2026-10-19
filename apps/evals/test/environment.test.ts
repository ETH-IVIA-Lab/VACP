import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertFreshBuilds } from '../src/run/environment';
import { EvalGateError } from '../src/results/gate';

test('eval startup requires current builds for workspace dependencies', () => {
  const root = mkdtempSync(join(tmpdir(), 'vacp-eval-builds-'));
  try {
    const app = join(root, 'apps/evals');
    const source = join(root, 'packages/agent-ai-sdk/src');
    const output = join(root, 'packages/agent-ai-sdk/dist');
    const unrelated = join(root, 'packages/data-duckdb');
    const python = join(root, 'packages/python');
    for (const dir of [app, source, output, join(unrelated, 'src'), join(python, 'src')])
      mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(app, 'package.json'),
      JSON.stringify({ dependencies: { '@ethivia/vacp-ai-sdk': 'workspace:*', ai: 'catalog:' } }),
    );
    writeFileSync(join(root, 'packages/agent-ai-sdk/package.json'), JSON.stringify({ name: '@ethivia/vacp-ai-sdk' }));
    writeFileSync(join(unrelated, 'package.json'), JSON.stringify({ name: '@ethivia/vacp-duckdb' }));
    writeFileSync(join(unrelated, 'src/index.ts'), 'export {};');
    writeFileSync(join(python, 'src/__init__.py'), '');
    const input = join(source, 'index.ts');
    const built = join(output, 'index.js');
    writeFileSync(input, 'export {};');
    writeFileSync(built, 'export {};');
    utimesSync(built, 1, 1);
    utimesSync(input, 2, 2);

    assert.throws(assertFreshBuilds.bind(null, root), {
      name: EvalGateError.name,
      message: 'The built agent-ai-sdk predate their source. Run `make build-libs` first.',
    });

    utimesSync(built, 3, 3);
    assert.doesNotThrow(assertFreshBuilds.bind(null, root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
