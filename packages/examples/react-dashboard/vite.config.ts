import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, '../../..');

function normalizeBasePath(raw: string | undefined): string {
  const v = String(raw ?? '').trim();
  if (!v) return '/';
  let base = v;
  if (!base.startsWith('/')) base = `/${base}`;
  if (!base.endsWith('/')) base = `${base}/`;
  return base;
}

const base = normalizeBasePath(process.env.VACP_BASE_PATH);
const hmr = base !== '/' ? { path: `${base}__hmr` } : undefined;

// https://vite.dev/config/
export default defineConfig({
  base,
  envPrefix: ['VITE_', 'VACP_'],
  // Isolate optimize-deps cache per example to avoid cross-test interference when
  // multiple Vite dev servers run concurrently in Playwright.
  cacheDir: process.env.VACP_VITE_CACHE_DIR ?? 'node_modules/.vite-react-dashboard',
  plugins: [react(), tailwind()],
  server: { fs: { allow: [workspaceRoot] }, ...(hmr ? { hmr } : {}) },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
