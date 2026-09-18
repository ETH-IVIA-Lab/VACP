import { defineConfig } from 'vite-plus';
import { antiSlopIgnorePatterns, antiSlopRules } from './tools/oxlint/anti-slop/preset.ts';
import type { OxlintOverride } from 'vite-plus/lint';

const ignoredPaths = [
  ...antiSlopIgnorePatterns,
  '**/dist/**',
  '**/build/**',
  '**/.vite-plus/**',
  '**/.vite/**',
  '**/.artifacts/**',
  '**/tasks/**',
  '**/node_modules/**',
  '**/.venv/**',
  '**/__pycache__/**',
  '**/*.lock',
  'pnpm-lock.yaml',
  '**/.pytest_cache/**',
  '**/test-results/**',
  'examples/**/public/data/**',
  'nogit/**',
  'plans/**',
  'ara/**',
  '**/.generated-public/**',
  '**/public/**',
  '**/.vitepress/cache/**',
  '**/.vitepress/dist/**',
];

export default defineConfig({
  fmt: {
    semi: true,
    singleQuote: true,
    printWidth: 120,
    trailingComma: 'all',
    ignorePatterns: ignoredPaths,
  },
  lint: {
    plugins: ['typescript', 'import'],
    jsPlugins: [{ name: 'anti-slop', specifier: './tools/oxlint/anti-slop/index.ts' }],
    ignorePatterns: ignoredPaths,
    rules: {
      ...antiSlopRules,
      'oxc/no-accumulating-spread': 'error',
      'eslint/no-console': 'off',
      'import/no-cycle': 'error',
    },
    overrides: Object.entries({
      protocol: [],
      runtime: ['protocol'],
      'runtime-browser': ['protocol', 'runtime'],
      'transport-bridge': ['protocol'],
      'transport-webmcp': ['protocol', 'runtime'],
      'data-duckdb': ['protocol'],
      'diagram-mermaid': ['protocol'],
      analytics: ['protocol'],
      'analytics-posthog': ['protocol', 'analytics'],
      'agent-ai-sdk': ['protocol', 'transport-bridge'],
      sdk: ['protocol', 'runtime', 'runtime-browser'],
      'adapter-vega-lite': ['protocol', 'runtime', 'runtime-browser', 'data-duckdb'],
      'adapter-vgplot': ['protocol', 'runtime', 'runtime-browser', 'data-duckdb'],
      inspector: ['protocol', 'runtime-browser', 'transport-bridge', 'agent-ai-sdk', 'diagram-mermaid', 'inspector'],
    }).map(
      ([owner, dependencies]) =>
        ({
          files: [`packages/${owner}/src/**`],
          rules: {
            'no-restricted-imports': [
              'error',
              {
                patterns: [
                  {
                    group: [
                      '@vacp/*',
                      '@vacp/*/**',
                      ...dependencies.flatMap((name) => [`!@vacp/${name}`, `!@vacp/${name}/**`]),
                    ],
                    message: 'Keep dependencies inward. Compose adapters in applications.',
                  },
                  {
                    group: ['../**/apps/**', '../**/packages/**', '../**/src/**', '../**/evals/**'],
                    message: 'Import workspace packages through their public exports.',
                  },
                ],
              },
            ],
          },
        }) satisfies OxlintOverride,
    ),
  },
});
