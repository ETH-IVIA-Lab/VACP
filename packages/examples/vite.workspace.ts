import { resolve } from 'node:path';
import type { AliasOptions } from 'vite';

const workspacePackages = [
  ['@vacp/core', 'packages/lib/protocol/core/src/index.ts'],
  ['@vacp/duckdb', 'packages/lib/protocol/duckdb/src/index.ts'],
  ['@vacp/gateway', 'packages/lib/protocol/gateway/src/index.ts'],
  ['@vacp/kit', 'packages/lib/protocol/kit/src/index.ts'],
  ['@vacp/diagrams', 'packages/lib/protocol/diagrams/src/index.ts'],
  ['@vacp/analytics', 'packages/lib/tooling/analytics/src/index.ts'],
  ['@vacp/debug-ui', 'packages/lib/tooling/debug-ui/src/index.ts'],
  ['@vacp/agent-client', 'packages/lib/transports/agent-client/src/index.ts'],
  ['@vacp/vega-lite', 'packages/lib/providers/vega-lite/src/index.ts'],
  ['@vacp/vgplot', 'packages/lib/providers/vgplot/src/index.ts'],
] as const;

const vacpWorkspaceSourceEntries = [
  'index.html',
  '*/index.html',
  'src/**/*.{ts,tsx}',
  '../../lib/protocol/*/src/**/*.ts',
  '../../lib/providers/*/src/**/*.ts',
  '../../lib/tooling/analytics/src/**/*.ts',
  '../../lib/tooling/debug-ui/src/**/*.{ts,tsx}',
  '../../lib/transports/agent-client/src/**/*.ts',
];

const vacpExampleSiblingEntries = ['../*/src/**/*.{ts,tsx}'];

export function vacpWorkspaceOptimizeDeps(options: { includeExampleSiblings?: boolean } = {}) {
  return {
    exclude: workspacePackages.map(([name]) => name),
    entries: [...vacpWorkspaceSourceEntries, ...(options.includeExampleSiblings ? vacpExampleSiblingEntries : [])],
  };
}

export const vacpWorkspaceDedupe = ['react', 'react-dom'];

function exactPackageMatcher(name: string): RegExp {
  return new RegExp(`^${name.replace('/', '\\/')}$`);
}

export function normalizeVacpBasePath(raw: string | undefined): string {
  const v = String(raw ?? '').trim();
  if (!v) return '/';
  let base = v;
  if (!base.startsWith('/')) base = `/${base}`;
  if (!base.endsWith('/')) base = `${base}/`;
  return base;
}

export function vacpWorkspaceAliases(workspaceRoot: string): AliasOptions {
  const debugUiSrc = resolve(workspaceRoot, 'packages/lib/tooling/debug-ui/src');
  return [
    ...workspacePackages.map(([name, source]) => ({
      find: exactPackageMatcher(name),
      replacement: resolve(workspaceRoot, source),
    })),
    { find: /^@vacp\/debug-ui\/(.+)$/, replacement: `${debugUiSrc}/$1` },
  ];
}
