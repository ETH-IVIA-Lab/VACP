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
    // Declarations resolve sibling packages through their built `dist`, as a consumer does, so every
    // emitted type names a public entry.
    dts: { compilerOptions: { customConditions: [] } },
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
        files: ['packages/overlay/src/**'],
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
      // Each library imports only the public entries listed for it. The core imports its own layers by
      // relative path, and packages/sdk/test/layers.test.ts keeps those layers pointing inward.
      ...Object.entries({
        sdk: [],
        vega: ['sdk', 'sdk/data', 'sdk/presence'],
        vgplot: ['sdk', 'sdk/data', 'sdk/presence'],
        duckdb: ['sdk', 'sdk/data'],
        ai: ['sdk', 'sdk/agent'],
        overlay: ['sdk', 'sdk/presence'],
        posthog: ['sdk'],
      }).map(
        ([owner, dependencies]) =>
          ({
            files: [`packages/${owner}/src/**`],
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
                        ...dependencies.map((entry) => `!@ethivia/vacp-${entry}`),
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
