import type { ExperimentSummary, NormalizedRun, ToolByExperimentRow, ToolByScenarioRow } from '../stats.js';

export type ArenaFigure = {
  id: string;
  title: string;
  caption: string;
  svg: string;
  // JSON-serializable rows used to render the chart (post-aggregation).
  // Exported for downstream analysis + per-chart downloads in the HTML report.
  data: unknown[];
};

export type ArenaReportTheme = {
  width: number;
  fontFamily: string;
  fontSizePx: number;
  palette: string[];
  colors: {
    ink: string;
    grid: string;
    ok: string;
    warn: string;
    bad: string;
    info: string;
    neutral: string;
    subtle: string;
  };
};

export type ArenaChartContext = {
  document: Document;
  theme: ArenaReportTheme;
  runs: NormalizedRun[];
  summaries: ExperimentSummary[];
  toolByExperiment: ToolByExperimentRow[];
  toolByScenario: ToolByScenarioRow[];
  experimentDomain: string[];
  scenarioDomain: string[];
};

export type ArenaFigureLayout = {
  width?: number;
  height?: number;
  marginLeft?: number;
  marginRight?: number;
  marginTop?: number;
  marginBottom?: number;
};

export type ArenaChart<Config extends object = Record<string, never>> = {
  id: string;
  title: string;
  caption: string;
  isApplicable?: (ctx: ArenaChartContext) => boolean;
  // Returns the same rows that the Plot marks consume (post-filtering + post-aggregation).
  // Must be JSON-serializable.
  getData: (ctx: ArenaChartContext, config?: Config) => unknown[];
  render: (ctx: ArenaChartContext, config?: Config) => ArenaFigure;
};

export type ArenaAnyChart = ArenaChart<any>;
