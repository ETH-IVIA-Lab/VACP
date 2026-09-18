import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createMarkdownRenderer } from 'vitepress';
import { createMermaidDiagrams } from '../.vitepress/diagrams.mts';

test('failed renders are retryable and valid diagrams are ready before publication', async () => {
  const sourceDir = await mkdtemp(join(tmpdir(), 'vacp-docs-diagrams-'));
  const diagramsDir = join(sourceDir, 'diagrams');
  const source = '```mermaid\ngraph TD\nA-->B\n```';
  let calls = 0;
  const renderer = createMermaidDiagrams({
    sourceDir,
    diagramsDir,
    serverUrl: 'https://renderer.test',
    fetch: async () => {
      calls++;
      return calls === 1
        ? new Response('Service unavailable', { status: 503 })
        : new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    },
  });
  const markdown = await createMarkdownRenderer(sourceDir, { config: renderer.markdown });
  try {
    await writeFile(join(sourceDir, 'index.md'), source);
    await assert.rejects(renderer.plugin.buildStart(), /503/);
    await renderer.plugin.buildStart();
    const [asset] = await readdir(diagramsDir);
    assert.match(await readFile(join(diagramsDir, asset), 'utf8'), /<svg/);
    assert.ok(markdown.render(source).includes(`/diagrams/${asset}`));
    await renderer.plugin.buildStart();
    assert.equal(calls, 2);
    await writeFile(join(diagramsDir, asset), '<html>Bad cached response</html>');
    await renderer.plugin.buildStart();
    assert.equal(calls, 3);
    await renderer.plugin.transform('```mermaid\ngraph LR\nC-->D\n```', join(sourceDir, 'index.md'));
    assert.equal((await readdir(diagramsDir)).length, 2);
    await writeFile(join(sourceDir, 'index.md'), '```mermaid\ngraph LR\nC-->D\n```');
    await renderer.plugin.buildStart();
    assert.equal((await readdir(diagramsDir)).length, 1);
    assert.equal(calls, 4);
  } finally {
    await rm(sourceDir, { recursive: true, force: true });
  }
});
