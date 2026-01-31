export { generateArenaReport, type GenerateArenaReportArgs, type GenerateArenaReportDeps } from './generate-report.js';
export {
  DEFAULT_CHARTS,
  buildDefaultFigures,
  createChartContext,
  createTheme,
  DEFAULT_THEME,
  renderCharts,
  type ArenaAnyChart,
  type ArenaChart,
  type ArenaChartContext,
  type ArenaFigure,
  type ArenaFigureLayout,
  type ArenaReportTheme,
} from './charts.js';
export {
  DEFAULT_REPORT_SECTIONS,
  renderArenaReportHtml,
  type ArenaReportHtmlContext,
  type ArenaReportSection,
  type ArenaReportSummaryRow,
  type ArenaReportTaskIndexRow,
  type ArenaReportTaskSummaryRow,
} from './render-html.js';
