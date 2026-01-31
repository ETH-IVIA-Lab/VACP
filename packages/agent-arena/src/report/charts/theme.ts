import type { ArenaReportTheme } from './types.js';

export const DEFAULT_THEME: ArenaReportTheme = {
  width: 920,
  fontFamily: '"IBM Plex Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
  fontSizePx: 12,
  palette: [
    '#4e79a7',
    '#f28e2b',
    '#e15759',
    '#76b7b2',
    '#59a14f',
    '#edc949',
    '#af7aa1',
    '#ff9da7',
    '#9c755f',
    '#bab0ab',
  ],
  colors: {
    ink: '#111827',
    grid: '#e5e7eb',
    ok: '#1d4ed8',
    bad: '#b91c1c',
    neutral: '#6b7280',
  },
};

export function createTheme(overrides: Partial<ArenaReportTheme> = {}): ArenaReportTheme {
  const colors = overrides.colors ? { ...DEFAULT_THEME.colors, ...overrides.colors } : DEFAULT_THEME.colors;
  return {
    ...DEFAULT_THEME,
    ...overrides,
    palette: overrides.palette ?? DEFAULT_THEME.palette,
    colors,
  };
}
