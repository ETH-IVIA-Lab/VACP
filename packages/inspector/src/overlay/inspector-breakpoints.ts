export const INSPECTOR_PANEL_BREAKPOINTS = {
  denseWidth: 560,
  denseHeight: 360,
  compactShell: 760,
  compactControls: 760,
  stackLegend: 720,
  splitPane: 980,
  chatCompactPanel: 520,
  chatInlineActivity: 1120,
} as const;

export function isDenseInspectorPanel(width: number, height: number): boolean {
  return width < INSPECTOR_PANEL_BREAKPOINTS.denseWidth || height < INSPECTOR_PANEL_BREAKPOINTS.denseHeight;
}
