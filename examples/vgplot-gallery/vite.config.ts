import { defineConfig } from 'vite-plus';
import tailwind from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  normalizeVacpBasePath,
  vacpWorkspaceAliases,
  vacpWorkspaceDedupe,
  vacpWorkspaceOptimizeDeps,
} from '../../vite.shared';

const __dirname = dirname(fileURLToPath(import.meta.url));

const workspaceRoot = resolve(__dirname, '../..');

const base = normalizeVacpBasePath(process.env.VACP_BASE_PATH);

const hmr = base !== '/' ? { path: `${base}__hmr` } : undefined;

export default defineConfig({
  base,
  envPrefix: ['VITE_', 'VACP_'],
  // Isolate optimize-deps cache per example to avoid cross-test interference when
  // multiple Vite dev servers run concurrently in Playwright.
  cacheDir: process.env.VACP_VITE_CACHE_DIR ?? 'node_modules/.vite-vgplot-gallery',
  plugins: [tailwind()],
  optimizeDeps: vacpWorkspaceOptimizeDeps(),
  resolve: {
    alias: vacpWorkspaceAliases(workspaceRoot),
    dedupe: vacpWorkspaceDedupe,
  },
  server: {
    fs: { allow: [workspaceRoot] },
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    ...(hmr ? { hmr } : {}),
  },
});
