export const DEBUG_UI_PANEL_BREAKPOINTS = {
  denseWidth: 560,
  denseHeight: 360,
  compactShell: 760,
  compactControls: 760,
  stackLegend: 720,
  splitPane: 980,
  chatCompactActions: 900,
  chatInlineActivity: 1120,
} as const;

export function isDenseDebugPanel(width: number, height: number): boolean {
  return width < DEBUG_UI_PANEL_BREAKPOINTS.denseWidth || height < DEBUG_UI_PANEL_BREAKPOINTS.denseHeight;
}
