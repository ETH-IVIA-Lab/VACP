import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vite-plus';
import {
  normalizeVacpBasePath,
  vacpPresenceSheet,
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
  cacheDir: process.env.VACP_VITE_CACHE_DIR ?? 'node_modules/.vite-cars-parallel-coords',
  plugins: [vacpPresenceSheet(workspaceRoot), tailwind()],
  optimizeDeps: vacpWorkspaceOptimizeDeps(),
  resolve: {
    alias: vacpWorkspaceAliases(workspaceRoot),
    dedupe: vacpWorkspaceDedupe,
  },
  server: { fs: { allow: [workspaceRoot] }, ...(hmr ? { hmr } : {}) },
});
