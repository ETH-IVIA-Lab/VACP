import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { transformSync, type BabelFileResult } from '@babel/core';
import jsxSyntax from '@babel/plugin-syntax-jsx';
import typescriptSyntax from '@babel/plugin-syntax-typescript';
import stylex, { type Rule } from '@stylexjs/babel-plugin';
import type { Plugin } from 'vite-plus';

// The StyleX Babel plugin reports each file's CSS rules in its metadata.
declare module '@babel/core' {
  interface BabelFileMetadata {
    stylex?: Rule[];
  }
}

const moduleFile = /\.[cm]?tsx?$/;
const importsStylex = (code: string) => code.includes('@stylexjs/stylex');
/** Bundlers report module ids with forward slashes on every platform. */
const slashes = (path: string) => path.replaceAll('\\', '/');

/**
 * Compile the StyleX modules under `root` and serve their finished CSS as the default export of `id`.
 *
 * A shadow root never sees document stylesheets, so the overlay adopts this string itself. The sheet
 * is built from every StyleX module under `root`, in path order, whenever it loads, which keeps it
 * complete and byte-identical however the bundler orders module transforms. Rules keep StyleX's
 * priority order inside cascade layers.
 */
export function stylexShadowSheet(options: { root: string; id: string }): Plugin {
  const root = slashes(resolve(options.root));
  const resolved = `\0${options.id}`;
  const compiled = new Map<string, { source: string; code: string; map: BabelFileResult['map']; rules: Rule[] }>();
  const compile = (file: string, source: string) => {
    const cached = compiled.get(file);
    if (cached?.source === source) return cached;
    const tsx = file.endsWith('x');
    const result = transformSync(source, {
      babelrc: false,
      configFile: false,
      filename: file,
      sourceMaps: true,
      plugins: [
        [typescriptSyntax, { isTSX: tsx }],
        ...(tsx ? [jsxSyntax] : []),
        stylex.withOptions({
          dev: false,
          runtimeInjection: false,
          treeshakeCompensation: true,
          unstable_moduleResolution: { type: 'commonJS', rootDir: root },
        }),
      ],
    });
    if (result?.code == null) throw new Error(`StyleX could not compile ${file}`);
    const entry = { source, code: result.code, map: result.map, rules: result.metadata?.stylex ?? [] };
    compiled.set(file, entry);
    return entry;
  };
  const modules = () =>
    readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((name) => moduleFile.test(name))
      .map((name) => slashes(join(root, name)))
      .sort();
  return {
    name: 'vacp:stylex-shadow-sheet',
    enforce: 'pre',
    resolveId: (id) => (id === options.id ? resolved : undefined),
    load(id) {
      if (id !== resolved) return;
      const rules: Rule[] = [];
      for (const file of modules()) {
        const source = readFileSync(file, 'utf8');
        if (!importsStylex(source)) continue;
        this.addWatchFile(file);
        rules.push(...compile(file, source).rules);
      }
      return `export default ${JSON.stringify(stylex.processStylexRules(rules, { useLayers: true }))};`;
    },
    transform(source, id) {
      const file = slashes(id.split('?')[0]!);
      if (!file.startsWith(`${root}/`) || !moduleFile.test(file) || !importsStylex(source)) return;
      const { code, map } = compile(file, source);
      return { code, map };
    },
    // A changed style module changes the sheet as well as its own class names, so the page reloads whole.
    hotUpdate({ file, server }) {
      if (!slashes(file).startsWith(`${root}/`) || !moduleFile.test(file)) return;
      const sheet = server.moduleGraph.getModuleById(resolved);
      if (sheet) server.moduleGraph.invalidateModule(sheet);
      server.ws.send({ type: 'full-reload' });
      return [];
    },
  };
}
