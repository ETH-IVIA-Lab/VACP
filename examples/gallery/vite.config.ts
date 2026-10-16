import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { defineExampleConfig } from '../../vite.shared';
import { examples } from './examples.manifest';

const page = (path: string) => fileURLToPath(new URL(path, import.meta.url));

function buildInput(): Record<string, string> {
  const inputs: Record<string, string> = { index: page('index.html') };
  for (const entry of examples) {
    const htmlPath = page(`${entry.route}/index.html`);
    if (!existsSync(htmlPath)) {
      throw new Error(`Missing generated route HTML: ${htmlPath}. Run node scripts/sync-generated.mjs`);
    }
    inputs[entry.route] = htmlPath;
  }
  return inputs;
}

export default defineExampleConfig({
  cacheName: 'gallery',
  config: {
    appType: 'mpa',
    publicDir: '.generated-public',
    // The gallery compiles the React dashboard's source, including its Tailwind stylesheet.
    plugins: [react(), tailwind()],
    build: { rolldownOptions: { input: buildInput() } },
  },
});
