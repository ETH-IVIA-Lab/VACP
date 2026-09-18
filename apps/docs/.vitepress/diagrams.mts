import { createHash } from 'node:crypto';
import { glob, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MarkdownRenderer } from 'vitepress';

export function createMermaidDiagrams(options: {
  sourceDir: string;
  diagramsDir: string;
  serverUrl: string;
  fetch?: typeof globalThis.fetch;
}) {
  const request = options.fetch ?? globalThis.fetch;
  const filename = (source: string) => `mermaid-${createHash('sha256').update(source).digest('hex')}.svg`;
  const validSvg = (text: string) =>
    /<svg[\s>]/.test(text) && text.includes('</svg>') && !text.includes('vpd-placeholder');
  const pending = new Map<string, Promise<void>>();
  let parser: MarkdownRenderer;

  async function generate(source: string): Promise<void> {
    const path = join(options.diagramsDir, filename(source));
    const cached = await readFile(path, 'utf8').catch(() => '');
    if (validSvg(cached)) return;
    const response = await request(`${options.serverUrl.replace(/\/$/, '')}/mermaid`, {
      method: 'POST',
      headers: { Accept: 'image/svg+xml', 'Content-Type': 'text/plain' },
      body: source,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Mermaid rendering failed (${response.status})`);
    const svg = await response.text();
    if (!validSvg(svg)) throw new Error('Mermaid renderer returned invalid SVG');
    await mkdir(options.diagramsDir, { recursive: true });
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    try {
      await writeFile(temporary, svg);
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async function prepare(markdown: string): Promise<string[]> {
    const tokens = parser.parse(markdown, {});
    return await Promise.all(
      tokens
        .filter((token) => token.type === 'fence' && token.info.trim() === 'mermaid')
        .map((token) => {
          const source = token.content.trim().replaceAll('\r\n', '\n');
          let task = pending.get(source);
          if (!task) {
            task = generate(source).finally(() => pending.delete(source));
            pending.set(source, task);
          }
          return task.then(() => filename(source));
        }),
    );
  }

  return {
    markdown(md: MarkdownRenderer) {
      parser = md;
      const fence = md.renderer.rules.fence;
      md.renderer.rules.fence = (tokens, index, settings, env, renderer) => {
        const token = tokens[index];
        if (token.info.trim() !== 'mermaid') return fence!(tokens, index, settings, env, renderer);
        const source = token.content.trim().replaceAll('\r\n', '\n');
        return `<figure class="mermaid-diagram"><img src="/diagrams/${filename(source)}" alt="Mermaid diagram"></figure>`;
      };
    },
    plugin: {
      name: 'vacp-docs-mermaid',
      enforce: 'pre' as const,
      async buildStart() {
        const used = new Set<string>();
        for await (const path of glob('**/*.md', { cwd: options.sourceDir })) {
          for (const name of await prepare(await readFile(join(options.sourceDir, path), 'utf8'))) used.add(name);
        }
        for await (const name of glob('mermaid-*.svg', { cwd: options.diagramsDir })) {
          if (!used.has(name)) await rm(join(options.diagramsDir, name), { force: true });
        }
      },
      async transform(source: string, id: string) {
        if (id.endsWith('.md')) await prepare(source);
      },
    },
  };
}
