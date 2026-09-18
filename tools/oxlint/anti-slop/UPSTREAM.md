# Source

Vendored from `dmmulroy/anti-slop` commit `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`, using that checkout's `skills/install-anti-slop/assets/anti-slop` bundle and matching `src/**/*.test.ts` tests.

The generic plugin is enabled through the root Vite+ configuration. Its tests and TypeScript checks run through the Makefile. Effect-specific rules are retained with their tests but are not enabled because this repository does not declare Effect.

The root MIT license and nested vendored license/provenance files are preserved. `preset.ts` and `tsconfig.json` are local integration files.

The local preset intentionally disables rules that prohibit boundary `unknown`, runtime narrowing, open dictionaries, assertions without mandatory comments, conditional spreads, and naming or spacing conventions. This keeps application contracts extensible and lets Vite+ own formatting. Generic ports retain known types; runtime validation remains at input boundaries. All vendored rules are still tested.
