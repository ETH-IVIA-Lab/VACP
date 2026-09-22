import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite-plus';
import {
  normalizeVacpBasePath,
  vacpWorkspaceAliases,
  vacpWorkspaceDedupe,
  vacpWorkspaceOptimizeDeps,
} from '../../vite.shared';
const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));
export default defineConfig({
  base: normalizeVacpBasePath(process.env.VACP_BASE_PATH),
  cacheDir: process.env.VACP_VITE_CACHE_DIR ?? 'node_modules/.vite-athletes',
  optimizeDeps: vacpWorkspaceOptimizeDeps(),
  resolve: { alias: vacpWorkspaceAliases(workspaceRoot), dedupe: vacpWorkspaceDedupe },
  server: { fs: { allow: [workspaceRoot] } },
});
