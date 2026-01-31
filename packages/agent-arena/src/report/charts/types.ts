import type { ExperimentSummary, NormalizedRun, ToolByExperimentRow } from '../stats.js';

export type ArenaFigure = {
  id: string;
  title: string;
  caption: string;
  svg: string;
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
    bad: string;
    neutral: string;
  };
};

export type ArenaChartContext = {
  document: Document;
  theme: ArenaReportTheme;
  runs: NormalizedRun[];
  summaries: ExperimentSummary[];
  toolByExperiment: ToolByExperimentRow[];
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
  render: (ctx: ArenaChartContext, config?: Config) => ArenaFigure;
};

export type ArenaAnyChart = ArenaChart<any>;
