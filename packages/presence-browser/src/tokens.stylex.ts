import * as stylex from '@stylexjs/stylex';

/** The overlay palette and motion curves, shared by every presence component. */
export const color = stylex.defineConsts({
  agent: '#4f6fd8',
  ink: '#202124',
  strong: '#172438',
  muted: '#697386',
  control: '#64748b',
  controlActive: '#334155',
  wash: '#f1f5f9',
  code: '#f1f5f9',
  quote: '#cbd5e1',
  rail: '#e2e8f0',
  railPast: '#cbd5e1',
  markPast: '#94a3b8',
  focus: '#60a5fa',
  surface: '#fff',
  edge: 'rgba(0,0,0,.08)',
  shadow: 'rgba(25,45,70,.10)',
});

export const ease = stylex.defineConsts({
  out: 'cubic-bezier(.23,1,.32,1)',
  reveal: 'cubic-bezier(.22,1,.36,1)',
});

/** The overlay root while motion is reduced: animations and transitions inside it stop. */
export const reducedMarker = stylex.defineMarker();
/** A label, whose hover and focus reveal its stepper. */
export const labelMarker = stylex.defineMarker();
