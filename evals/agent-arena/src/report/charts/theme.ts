import type { ArenaReportTheme } from './types.js';

export const DEFAULT_THEME: ArenaReportTheme = {
  width: 920,
  fontFamily: '"IBM Plex Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
  fontSizePx: 12,
  palette: ['#1d4ed8', '#3b82f6', '#94a3b8', '#15803d', '#b45309', '#b91c1c'],
  colors: {
    ink: '#0f172a',
    grid: '#d8dee8',
    ok: '#15803d',
    warn: '#b45309',
    bad: '#b91c1c',
    info: '#1d4ed8',
    neutral: '#64748b',
    subtle: '#cbd5e1',
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
