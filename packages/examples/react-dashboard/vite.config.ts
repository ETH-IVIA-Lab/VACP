import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, '../../..');

// https://vite.dev/config/
export default defineConfig({
  envPrefix: ['VITE_', 'VACP_'],
  // Isolate optimize-deps cache per example to avoid cross-test interference when
  // multiple Vite dev servers run concurrently in Playwright.
  cacheDir: process.env.VACP_VITE_CACHE_DIR ?? 'node_modules/.vite-react-dashboard',
  plugins: [react(), tailwind()],
  server: { fs: { allow: [workspaceRoot] } },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
