import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

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

export default defineConfig({
  base,
  envPrefix: ['VITE_', 'VACP_'],
  // Isolate optimize-deps cache per example to avoid cross-test interference when
  // multiple Vite dev servers run concurrently in Playwright.
  cacheDir: process.env.VACP_VITE_CACHE_DIR ?? 'node_modules/.vite-cars-parallel-coords',
  server: { fs: { allow: [workspaceRoot] }, ...(hmr ? { hmr } : {}) },
});

