import { defineConfig } from 'vite-plus';
import { antiSlopIgnorePatterns, antiSlopRules } from './tools/oxlint/anti-slop/preset';
import type { OxlintOverride } from 'vite-plus/lint';

const ignoredPaths = [
  ...antiSlopIgnorePatterns,
  '**/dist/**',
  '**/build/**',
  '**/.vite-plus/**',
  '**/.vite/**',
  '**/.artifacts/**',
  '**/node_modules/**',
  '**/.venv/**',
  '**/__pycache__/**',
  '**/*.lock',
  'pnpm-lock.yaml',
  '**/.pytest_cache/**',
  '**/test-results/**',
  'examples/**/public/data/**',
  '**/.generated-public/**',
  '**/public/**',
  '**/.vitepress/cache/**',
  '**/.vitepress/dist/**',
];

const sourceImportRestrictions = [
  {
    regex: '^\\.{1,2}/.*\\.[cm]?[jt]sx?$',
    message: 'Use extensionless imports for TypeScript modules.',
  },
];

export default defineConfig({
  pack: {
    entry: ['src/**/*.{ts,tsx,mts,cts}'],
    unbundle: true,
    root: 'src',
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    dts: true,
    sourcemap: true,
    report: false,
  },
  fmt: {
    semi: true,
    singleQuote: true,
    printWidth: 120,
    trailingComma: 'all',
    ignorePatterns: ignoredPaths,
  },
  lint: {
    options: { typeAware: true, typeCheck: true },
    plugins: ['typescript', 'import'],
    jsPlugins: [{ name: 'anti-slop', specifier: './tools/oxlint/anti-slop/index.ts' }],
    ignorePatterns: ignoredPaths,
    rules: {
      ...antiSlopRules,
      'oxc/no-accumulating-spread': 'error',
      'eslint/no-console': 'off',
      'import/no-cycle': 'error',
      // node:test reports every registered test's failure itself, so its registration promise needs no handler.
      'typescript/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            { from: 'package', package: 'node:test', name: ['test', 'describe', 'it', 'suite'] },
          ],
        },
      ],
    },
    overrides: [
      {
        files: ['packages/presence-browser/src/**'],
        plugins: ['react'],
        rules: {
          'react/rules-of-hooks': 'error',
          'react/exhaustive-deps': 'error',
          'react/jsx-key': 'error',
          'react/no-unstable-nested-components': 'error',
          'react/jsx-no-constructed-context-values': 'error',
          'react/set-state-in-render': 'error',
          'react/set-state-in-effect': 'error',
          'react/refs': 'error',
        },
      },
      {
        files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
        rules: {
          'no-restricted-imports': ['error', { patterns: sourceImportRestrictions }],
          'import/extensions': [
            'error',
            'ignorePackages',
            {
              ignorePackages: true,
              checkTypeImports: true,
              pattern: {
                ts: 'never',
                tsx: 'never',
                mts: 'never',
                cts: 'never',
                js: 'never',
                jsx: 'never',
                mjs: 'never',
                cjs: 'never',
              },
            },
          ],
        },
      },
      ...Object.entries({
        protocol: [],
        runtime: ['protocol'],
        'runtime-browser': ['protocol', 'runtime'],
        'transport-bridge': ['protocol'],
        'transport-webmcp': ['protocol'],
        'data-duckdb': ['protocol'],
        analytics: ['protocol'],
        'analytics-posthog': ['analytics'],
        'agent-ai-sdk': ['protocol', 'bridge'],
        sdk: ['protocol', 'runtime', 'browser'],
        'adapter-vega-lite': ['protocol', 'runtime', 'duckdb'],
        'adapter-vgplot': ['protocol', 'runtime', 'duckdb'],
        'inspector-core': ['protocol'],
        'provenance-core': ['protocol'],
        'presence-core': ['protocol', 'provenance'],
        'presence-browser': ['protocol', 'presence'],
        'adapter-vega-lite/src/presentation.ts': ['protocol', 'presence', 'presence/dom'],
        'adapter-vgplot/src/presentation.ts': ['protocol', 'presence', 'presence/dom'],
      }).map(
        ([owner, dependencies]) =>
          ({
            files: [owner.includes('/') ? `packages/${owner}` : `packages/${owner}/src/**`],
            rules: {
              'no-restricted-imports': [
                'error',
                {
                  patterns: [
                    ...sourceImportRestrictions,
                    {
                      group: [
                        '@ethivia/vacp-*',
                        '@ethivia/vacp-*/**',
                        ...dependencies.flatMap((name) => [`!@ethivia/vacp-${name}`, `!@ethivia/vacp-${name}/**`]),
                      ],
                      message: 'Keep dependencies inward. Compose adapters in applications.',
                    },
                    {
                      group: ['../**/apps/**', '../**/packages/**', '../**/src/**'],
                      message: 'Import workspace packages through their public exports.',
                    },
                  ],
                },
              ],
            },
          }) satisfies OxlintOverride,
      ),
    ],
  },
});
