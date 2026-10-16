import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultClientConditions, mergeConfig, type Plugin, type UserConfig } from 'vite-plus';
import { stylexShadowSheet } from './tools/stylex/shadow-sheet';

const workspaceRoot = fileURLToPath(new URL('.', import.meta.url));

/** Presence components are styled with StyleX and adopt the compiled sheet into their shadow root. */
export function vacpPresenceSheet(root: string): Plugin {
  return stylexShadowSheet({
    root: resolve(root, 'packages/presence-browser/src'),
    id: 'virtual:vacp-presence-sheet',
  });
}

function basePath(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return '/';
  return `${value.startsWith('/') ? '' : '/'}${value}${value.endsWith('/') ? '' : '/'}`;
}

/**
 * Vite configuration shared by every example application.
 *
 * Workspace libraries list a `vacp-source` export condition first, so examples compile library
 * source directly while published consumers resolve the built `dist` files. `VACP_BASE_PATH` serves
 * an example below a path prefix, and `VACP_VITE_CACHE_DIR` moves the dependency cache, which keeps
 * concurrent dev servers apart.
 */
export function defineExampleConfig(options: { cacheName: string; config?: UserConfig }): UserConfig {
  const base = basePath(process.env.VACP_BASE_PATH);
  return mergeConfig(
    {
      base,
      cacheDir: process.env.VACP_VITE_CACHE_DIR ?? `node_modules/.vite-${options.cacheName}`,
      envPrefix: ['VITE_', 'VACP_'],
      plugins: [vacpPresenceSheet(workspaceRoot)],
      resolve: { conditions: ['vacp-source', ...defaultClientConditions], dedupe: ['react', 'react-dom'] },
      server: { fs: { allow: [workspaceRoot] }, ...(base === '/' ? {} : { hmr: { path: `${base}__hmr` } }) },
    } satisfies UserConfig,
    options.config ?? {},
  );
}
