import { resolve } from 'node:path';
import type { Alias } from 'vite-plus';

const workspacePackages = [
  ['@vacp/transport-webmcp', 'packages/transport-webmcp/src/index.ts'],
  ['@vacp/runtime-browser', 'packages/runtime-browser/src/index.ts'],
  ['@vacp/transport-bridge', 'packages/transport-bridge/src/index.ts'],
  ['@vacp/protocol', 'packages/protocol/src/index.ts'],
  ['@vacp/data-duckdb', 'packages/data-duckdb/src/index.ts'],
  ['@vacp/runtime', 'packages/runtime/src/index.ts'],
  ['@vacp/sdk', 'packages/sdk/src/index.ts'],
  ['@vacp/diagram-mermaid', 'packages/diagram-mermaid/src/index.ts'],
  ['@vacp/analytics', 'packages/analytics/src/index.ts'],
  ['@vacp/analytics-posthog', 'packages/analytics-posthog/src/index.ts'],
  ['@vacp/inspector', 'packages/inspector/src/index.ts'],
  ['@vacp/agent-ai-sdk', 'packages/agent-ai-sdk/src/index.ts'],
  ['@vacp/adapter-vega-lite', 'packages/adapter-vega-lite/src/index.ts'],
  ['@vacp/adapter-vgplot', 'packages/adapter-vgplot/src/index.ts'],
] as const;

const vacpWorkspaceSourceEntries = [
  'index.html',
  '*/index.html',
  'src/**/*.{ts,tsx}',
  '../../packages/*/src/**/*.{ts,tsx}',
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

export function vacpWorkspaceAliases(workspaceRoot: string): Alias[] {
  const inspectorSrc = resolve(workspaceRoot, 'packages/inspector/src');

  return [
    ...workspacePackages.map(([name, source]) => ({
      find: exactPackageMatcher(name),
      replacement: resolve(workspaceRoot, source),
    })),
    { find: /^@vacp\/inspector\/(.+)$/, replacement: `${inspectorSrc}/$1` },
  ];
}
