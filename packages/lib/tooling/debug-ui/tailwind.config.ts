import type { Config } from 'tailwindcss';

export default {
  // This is a library overlay: avoid affecting host apps.
  // - no preflight resets
  // - scope utilities to the overlay root
  corePlugins: { preflight: false },
  important: '[data-vacp-debug-ui]',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
