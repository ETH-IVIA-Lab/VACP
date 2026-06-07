import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import {
  normalizeVacpBasePath,
  vacpWorkspaceAliases,
  vacpWorkspaceDedupe,
  vacpWorkspaceOptimizeDeps,
} from '../vite.workspace';

type ManifestEntry = {
  id: string;
  route: string;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, '../../..');
const manifestPath = resolve(__dirname, 'examples.manifest.json');

function readManifest(): ManifestEntry[] {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
  if (!Array.isArray(raw)) throw new Error('examples.manifest.json must be an array');
  const entries = raw.filter(
    (value): value is ManifestEntry =>
      typeof value === 'object' &&
      value !== null &&
      typeof (value as any).id === 'string' &&
      typeof (value as any).route === 'string',
  );
  if (entries.length !== raw.length) throw new Error('Invalid manifest entry');
  return entries;
}

function buildInput(): Record<string, string> {
  const inputs: Record<string, string> = {
    index: resolve(__dirname, 'index.html'),
  };
  for (const entry of readManifest()) {
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
  base,
  envPrefix: ['VITE_', 'VACP_'],
  publicDir: '.generated-public',
  plugins: [react(), tailwind()],
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
