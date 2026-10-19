import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { defineExampleConfig } from '../../vite.shared';
import { examples } from './examples.manifest';

const page = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// `dev` and `build` run scripts/sync-generated.ts first, which writes each route's index.html.
function buildInput(): Record<string, string> {
  return Object.fromEntries([
    ['index', page('index.html')],
    ...examples.map((entry) => [entry.route, page(`${entry.route}/index.html`)]),
  ]);
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
