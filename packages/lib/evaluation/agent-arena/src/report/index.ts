export { generateArenaReport, type GenerateArenaReportArgs, type GenerateArenaReportDeps } from './generate-report.js';
export {
  generateArenaReportSuite,
  type GenerateArenaReportSuiteArgs,
  type GenerateArenaReportSuiteResult,
} from './generate-report-suite.js';
export { exportArenaDatasets, type ExportArenaDatasetsArgs } from './export-datasets.js';
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

export {
  renderArenaReportIndexHtml,
  type ArenaReportIndexHtmlContext,
  type ArenaReportIndexModelRow,
} from './render-index.js';
