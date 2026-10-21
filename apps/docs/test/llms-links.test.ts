import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import type { SiteConfig } from 'vitepress';
import { rewriteLlmsLinks } from '../.vitepress/llms-links';

const view = (url: string, body: string) => `---\nurl: ${url}\n---\n${body}`;

// Lays out `outDir` the way vitepress-plugin-llms writes it for the home page, `agents/index.md`, and
// `agents/webmcp.md`: the home page has no view, and `agents/index.md` becomes `agents.md`.
function site(t: TestContext, base: string, pages: { agents: string; webmcp?: string; index?: string }) {
  const outDir = mkdtempSync(path.join(tmpdir(), 'vacp-llms-links-'));
  t.after(() => rmSync(outDir, { recursive: true, force: true }));
  const agents = view(`${base}agents.md`, pages.agents);
  const webmcp = view(`${base}agents/webmcp.md`, pages.webmcp ?? '# WebMCP\n');
  const files: Record<string, string> = {
    'llms.txt':
      pages.index ?? `# VACP\n\n- [Connect an agent](${base}agents.md)\n- [WebMCP](${base}agents/webmcp.md)\n`,
    'agents.md': agents,
    'agents/webmcp.md': webmcp,
    'llms-full.txt': `${agents}\n${webmcp}`,
    'images/teaser.svg': '<svg />',
    'images/a&b.svg': '<svg />',
  };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(outDir, file)), { recursive: true });
    writeFileSync(path.join(outDir, file), text);
  }
  // SAFETY: rewriteLlmsLinks reads only `outDir`, `pages`, and `site.base`.
  const config = { outDir, pages: ['index.md', 'agents/index.md', 'agents/webmcp.md'], site: { base } } as SiteConfig;
  return {
    files,
    rewrite: () => rewriteLlmsLinks(config),
    read: (file: string) => readFileSync(path.join(outDir, file), 'utf8'),
  };
}

test('relative links resolve against the page route to the view, page, or file under the site base', (t) => {
  const agents = [
    '# Connect an agent',
    '',
    'Read [WebMCP](./webmcp?tab=1#tools) or its [specification](https://webmachinelearning.github.io/webmcp/), go [home](../), or jump to [transports](#transports).',
    '',
    '![Teaser](/images/teaser.svg)',
    '',
    '[tools]: webmcp.md#tools',
    '',
  ].join('\n');
  const webmcp = '# WebMCP\n\nBack to [agents](./#transports).\n';
  for (const base of ['/', '/VACP/']) {
    const { rewrite, read } = site(t, base, { agents, webmcp });
    rewrite();
    const expected = {
      agents: view(
        `${base}agents.md`,
        [
          '# Connect an agent',
          '',
          `Read [WebMCP](${base}agents/webmcp.md?tab=1#tools) or its [specification](https://webmachinelearning.github.io/webmcp/), go [home](${base}), or jump to [transports](#transports).`,
          '',
          `![Teaser](${base}images/teaser.svg)`,
          '',
          `[tools]: ${base}agents/webmcp.md#tools`,
          '',
        ].join('\n'),
      ),
      webmcp: view(`${base}agents/webmcp.md`, `# WebMCP\n\nBack to [agents](${base}agents.md#transports).\n`),
    };
    assert.equal(read('agents.md'), expected.agents, base);
    assert.equal(read('agents/webmcp.md'), expected.webmcp, base);
    assert.equal(read('llms-full.txt'), `${expected.agents}\n${expected.webmcp}`, base);
  }
});

test('code blocks stay as written and frontmatter shown in code stays inside its page', (t) => {
  const code = [
    '```md',
    '---',
    'url: /agents.md',
    '---',
    '[Missing](./missing)',
    '```',
    '',
    '    [WebMCP](./webmcp)',
    '',
  ].join('\n');
  const { rewrite, read } = site(t, '/', { agents: `# Connect an agent\n\n${code}\n[WebMCP](./webmcp)\n` });
  rewrite();
  const agents = view('/agents.md', `# Connect an agent\n\n${code}\n[WebMCP](/agents/webmcp.md)\n`);
  assert.equal(read('agents.md'), agents);
  assert.equal(read('llms-full.txt'), `${agents}\n${view('/agents/webmcp.md', '# WebMCP\n')}`);
});

test('escaped destinations resolve and stay escaped', (t) => {
  const { rewrite, read } = site(t, '/VACP/', {
    agents: '# Connect an agent\n\n![Plain](/images/a\\&b.svg) and ![Angle](</images/a\\&b.svg>)\n',
  });
  rewrite();
  assert.equal(
    read('agents.md'),
    view(
      '/VACP/agents.md',
      '# Connect an agent\n\n![Plain](/VACP/images/a\\&b.svg) and ![Angle](</VACP/images/a\\&b.svg>)\n',
    ),
  );
});

test('a dead link fails the build with its page named and leaves every view unwritten', (t) => {
  const { files, rewrite, read } = site(t, '/', {
    agents: '# Connect an agent\n\n[WebMCP](./webmcp) and [Missing](./missing)\n',
  });
  assert.throws(rewrite, /\.\/missing in agents\/index\.md/);
  for (const [file, text] of Object.entries(files)) assert.equal(read(file), text, file);
});

test('an llms.txt link that names no view under the base fails the build', (t) => {
  const { rewrite } = site(t, '/VACP/', {
    agents: '# Connect an agent\n',
    index: '# VACP\n\n- [Connect an agent](/agents.md)\n- [WebMCP](/VACP/agents/webmcp)\n',
  });
  assert.throws(rewrite, (error: Error) => {
    assert.match(error.message, /\/agents\.md in llms\.txt/);
    assert.match(error.message, /\/VACP\/agents\/webmcp in llms\.txt/);
    return true;
  });
});
