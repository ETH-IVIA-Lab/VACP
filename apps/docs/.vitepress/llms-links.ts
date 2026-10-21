import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse, postprocess, preprocess } from 'micromark';
import { decodeString } from 'micromark-util-decode-string';
import { normalizeUri } from 'micromark-util-sanitize-uri';
import type { SiteConfig } from 'vitepress';

interface Page {
  source: string;
  route: string;
  // Links to the page use its Markdown view, or its HTML route when it has no view.
  url: string;
}

// vitepress-plugin-llms opens every view, and every page in `llms-full.txt`, with this frontmatter.
const frontmatter = /---\nurl: (\S+)\n(?:.*\n)*?---\n/y;
const kept = /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i;
const destinations = new Set(['resourceDestinationString', 'definitionDestinationString']);
// Markdown decodes escapes and character references in a destination. Escaping these characters makes a
// plain or a `<…>` destination read back as the exact URL.
const escape = (url: string) => url.replace(/[\\&()<>]/g, '\\$&');
const tokenize = (markdown: string) => {
  const chunks = preprocess()(markdown, undefined, true);
  return postprocess(parse().document().write(chunks));
};

/**
 * Points each relative and root-relative link in the Markdown views and `llms-full.txt` at the view,
 * page, or file it names, under the site base, and throws on links that name none of them and on
 * `llms.txt` links that name no view.
 *
 * The plugin writes each page to a flattened path, `agents/index.md` to `agents.md`, and copies the
 * authored links unchanged. VitePress resolves those links against the page route, so this resolves
 * them the same way. Runs as `buildEnd`, after the plugin has written its files to `outDir`.
 */
export function rewriteLlmsLinks(siteConfig: SiteConfig): void {
  const { outDir, site } = siteConfig;
  const isFile = (file: string) => statSync(path.join(outDir, file), { throwIfNoEntry: false })?.isFile() ?? false;
  const pages = new Map<string, Page>();
  const views = new Map<string, Page>();
  for (const source of siteConfig.pages) {
    const key = source.slice(0, -'.md'.length);
    const route = `/${key}`.replace(/\/index$/, '/');
    const view = `${key.replace(/\/index$/, '')}.md`;
    const hasView = isFile(view);
    const page = { source, route, url: `${site.base}${hasView ? view : route.slice(1)}` };
    pages.set(key, page);
    if (hasView) views.set(view, page);
  }
  const dead = new Set<string>();
  // The plugin drops the base from `llms.txt` links in nested sidebar sections.
  const index = readFileSync(path.join(outDir, 'llms.txt'), 'utf8');
  for (const [kind, token] of tokenize(index)) {
    if (kind === 'enter' && destinations.has(token.type)) {
      const href = decodeString(index.slice(token.start.offset, token.end.offset));
      if (!kept.test(href) && views.get(href.slice(site.base.length))?.url !== href) dead.add(`${href} in llms.txt`);
    }
  }

  const resolve = (href: string, page: Page) => {
    // Percent-encoding the destination the way the rendered page's link does turns a bare `%` into `%25`.
    const url = new URL(normalizeUri(href), `http://site${page.route}`);
    const file = decodeURIComponent(url.pathname.slice(1));
    const target = pages.get(file === '' || file.endsWith('/') ? `${file}index` : file.replace(/\.(?:md|html)$/, ''));
    if (target) return `${target.url}${url.search}${url.hash}`;
    if (isFile(file)) return `${site.base}${url.pathname.slice(1)}${url.search}${url.hash}`;
    dead.add(`${href} in ${page.source}`);
    return href;
  };

  const rewrite = (body: string, page: Page) => {
    let text = '';
    let last = 0;
    for (const [kind, token] of tokenize(body)) {
      if (kind === 'enter' && destinations.has(token.type)) {
        const source = body.slice(token.start.offset, token.end.offset);
        const href = decodeString(source);
        text += body.slice(last, token.start.offset) + (kept.test(href) ? source : escape(resolve(href, page)));
        last = token.end.offset;
      }
    }
    return text + body.slice(last);
  };

  const files = [...views.keys(), 'llms-full.txt'].map((file) => {
    const text = readFileSync(path.join(outDir, file), 'utf8');
    const full = file === 'llms-full.txt';
    // Each page in `llms-full.txt` starts at a thematic break that opens its frontmatter. Code blocks hold
    // no thematic breaks, so frontmatter shown in a code example stays part of its page.
    const starts = full
      ? tokenize(text).flatMap(([kind, token]) =>
          kind === 'enter' && token.type === 'thematicBreak' ? [token.start.offset] : [],
        )
      : [0];
    const blocks = starts.flatMap((start) => {
      frontmatter.lastIndex = start;
      const block = frontmatter.exec(text);
      return block ? [block] : [];
    });
    const expected = full ? views.size : 1;
    if (blocks[0]?.index !== 0 || blocks.length !== expected) {
      throw new Error(
        `Expected ${expected} view frontmatter blocks from the first line of ${file}, found ${blocks.length}.`,
      );
    }
    const parts = blocks.map((block, index) => {
      const [head, url = ''] = block;
      const page = views.get(url.slice(site.base.length));
      if (page?.url !== url) throw new Error(`${file} holds ${url}, which is no page's view.`);
      return head + rewrite(text.slice(block.index + head.length, blocks[index + 1]?.index), page);
    });
    return [file, parts.join('')] as const;
  });
  if (dead.size > 0) {
    throw new Error(`Dead links in the Markdown views:\n${[...dead].map((entry) => `  ${entry}`).join('\n')}`);
  }
  for (const [file, text] of files) writeFileSync(path.join(outDir, file), text);
}
