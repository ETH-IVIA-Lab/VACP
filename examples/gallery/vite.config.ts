import { defineConfig } from 'vite-plus';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { examples } from './examples.manifest';
import {
  normalizeVacpBasePath,
  vacpPresenceSheet,
  vacpWorkspaceAliases,
  vacpWorkspaceDedupe,
  vacpWorkspaceOptimizeDeps,
} from '../../vite.shared';

const __dirname = dirname(fileURLToPath(import.meta.url));

const workspaceRoot = resolve(__dirname, '../..');

function buildInput(): Record<string, string> {
  const inputs: Record<string, string> = {
    index: resolve(__dirname, 'index.html'),
  };

  for (const entry of examples) {
    const htmlPath = resolve(__dirname, entry.route, 'index.html');

    if (!existsSync(htmlPath)) {
      throw new Error(`Missing generated route HTML: ${htmlPath}. Run node scripts/sync-generated.mjs`);
    }

    inputs[entry.route] = htmlPath;
  }

  return inputs;
}

const base = normalizeVacpBasePath(process.env.VACP_BASE_PATH);

const hmr = base !== '/' ? { path: `${base}__hmr` } : undefined;

export default defineConfig({
  appType: 'mpa',
  cacheDir: process.env.VACP_VITE_CACHE_DIR ?? 'node_modules/.vite-gallery',
  base,
  envPrefix: ['VITE_', 'VACP_'],
  publicDir: '.generated-public',
  plugins: [vacpPresenceSheet(workspaceRoot), react(), tailwind()],
  optimizeDeps: vacpWorkspaceOptimizeDeps({ includeExampleSiblings: true }),
  server: {
    fs: { allow: [workspaceRoot] },
    ...(hmr ? { hmr } : {}),
  },
  resolve: {
    alias: [
      ...vacpWorkspaceAliases(workspaceRoot),
      { find: '@', replacement: resolve(__dirname, '../react-dashboard/src') },
    ],
    dedupe: vacpWorkspaceDedupe,
  },
  build: {
    rolldownOptions: {
      input: buildInput(),
    },
  },
});
