import { defineConfig } from 'vite-plus';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
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

// https://vite.dev/config/
export default defineConfig({
  base,
  envPrefix: ['VITE_', 'VACP_'],
  // Isolate optimize-deps cache per example to avoid cross-test interference when
  // multiple Vite dev servers run concurrently in Playwright.
  cacheDir: process.env.VACP_VITE_CACHE_DIR ?? 'node_modules/.vite-react-dashboard',
  plugins: [vacpPresenceSheet(workspaceRoot), react(), tailwind()],
  optimizeDeps: vacpWorkspaceOptimizeDeps(),
  server: { fs: { allow: [workspaceRoot] }, ...(hmr ? { hmr } : {}) },
  resolve: {
    alias: [...vacpWorkspaceAliases(workspaceRoot), { find: '@', replacement: resolve(__dirname, './src') }],
    dedupe: vacpWorkspaceDedupe,
  },
});
