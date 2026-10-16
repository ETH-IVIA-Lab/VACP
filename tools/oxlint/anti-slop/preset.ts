import plugin from './index.ts';

export const antiSlopIgnorePatterns = [
  '.agent/**', '.agents/**', '.claude/**', '.codex/**', '.continue/**', '.cursor/**',
  '.gemini/**', '.opencode/**', '.pi/**', '.roo/**', '.windsurf/**', 'tools/oxlint/anti-slop/**',
];

// Open protocol payloads need unknown values and ordinary TypeScript narrowing.
// Formatting belongs to Vite+; assertions remain subject to strict type checking.
const disabledRules = new Set([
  'no-runtime-typeof',
  'no-unknown-parameters',
  'no-unknown-returns',
  'no-unknown-type-aliases',
  'no-unsafe-dictionary-type',
  'no-known-value-widening',
  'no-conditional-empty-object-spread',
  'no-shape-in-symbol-names',
  'require-readable-spacing',
  'require-safety-comment-for-type-assertion',
]);

export const antiSlopRules = Object.fromEntries(
  Object.keys(plugin.rules).map((name) => [
    `anti-slop/${name}`,
    disabledRules.has(name) ? 'off' : 'error',
  ]),
);
