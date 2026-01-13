import { defineConfig } from 'vite';

export default defineConfig({
  envPrefix: ['VITE_', 'VACP_'],
  // Isolate optimize-deps cache per example to avoid cross-test interference when
  // multiple Vite dev servers run concurrently in Playwright.
  cacheDir: process.env.VACP_VITE_CACHE_DIR ?? 'node_modules/.vite-vanilla-minimal',
});
