import { resolve } from 'node:path';
import type { Alias } from 'vite-plus';

const workspacePackages = [
  ['@vacp/provenance-core', 'packages/provenance-core/src/index.ts'],
  ['@vacp/presence-core', 'packages/presence-core/src/index.ts'],
  ['@vacp/presence-browser', 'packages/presence-browser/src/index.ts'],
  ['@vacp/presence-browser/streamdown', 'packages/presence-browser/src/streamdown.ts'],
  ['@vacp/presence-browser/targets', 'packages/presence-browser/src/targets.ts'],
  ['@vacp/adapter-vega-lite/presentation', 'packages/adapter-vega-lite/src/presentation.ts'],
  ['@vacp/adapter-vgplot/presentation', 'packages/adapter-vgplot/src/presentation.ts'],
  ['@vacp/inspector-core', 'packages/inspector-core/src/index.ts'],
  ['@vacp/inspector-core/runtime', 'packages/inspector-core/src/runtime.ts'],
  ['@vacp/inspector-core/http', 'packages/inspector-core/src/http.ts'],
  ['@vacp/protocol/validation', 'packages/protocol/src/validation.ts'],
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
  return [
    ...workspacePackages.map(([name, source]) => ({
      find: exactPackageMatcher(name),
      replacement: resolve(workspaceRoot, source),
    })),
  ];
}
