import type { ExperimentSummary, NormalizedRun, ToolByExperimentRow } from './stats.js';
import type { ArenaAnyChart, ArenaChartContext, ArenaFigure, ArenaReportTheme } from './charts/types.js';
import { createTheme, DEFAULT_THEME } from './charts/theme.js';
import { durationChart } from './charts/duration.js';
import { flagsHeatmapChart } from './charts/flags-heatmap.js';
import { paretoChart } from './charts/pareto.js';
import { scenarioDurationHeatmapChart } from './charts/scenario-duration-heatmap.js';
import { scenarioSolvedHeatmapChart } from './charts/scenario-solved-heatmap.js';
import { scenarioTokensHeatmapChart } from './charts/scenario-tokens-heatmap.js';
import { solvedSemanticChart } from './charts/solved-semantic.js';
import { solvedStrictChart } from './charts/solved-strict.js';
import { tokensChart } from './charts/tokens.js';
import { toolCallsChart } from './charts/tool-calls.js';
import { toolsHeatmapChart } from './charts/tools-heatmap.js';

export type {
  ArenaAnyChart,
  ArenaChart,
  ArenaChartContext,
  ArenaFigure,
  ArenaFigureLayout,
  ArenaReportTheme,
} from './charts/types.js';
export { DEFAULT_THEME, createTheme } from './charts/theme.js';

export const DEFAULT_CHARTS: ArenaAnyChart[] = [
  solvedStrictChart,
  solvedSemanticChart,
  paretoChart,
  durationChart,
  tokensChart,
  toolCallsChart,
  flagsHeatmapChart,
  scenarioSolvedHeatmapChart,
  scenarioDurationHeatmapChart,
  scenarioTokensHeatmapChart,
  toolsHeatmapChart,
];

export function renderCharts(args: {
  ctx: ArenaChartContext;
  charts: ArenaAnyChart[];
  configById?: Record<string, unknown>;
}): ArenaFigure[] {
  const out: ArenaFigure[] = [];
  for (const chart of args.charts) {
    if (chart.isApplicable && !chart.isApplicable(args.ctx)) continue;
    const cfg = args.configById?.[chart.id];
    out.push(chart.render(args.ctx, cfg as any));
  }
  return out;
}

export function buildDefaultFigures(args: {
  document: Document;
  runs: NormalizedRun[];
  summaries: ExperimentSummary[];
  toolByExperiment: ToolByExperimentRow[];
  experimentDomain: string[];
  scenarioDomain: string[];
  theme?: Partial<ArenaReportTheme>;
  charts?: ArenaAnyChart[];
  chartConfigById?: Record<string, unknown>;
}): ArenaFigure[] {
  const theme = args.theme ? createTheme(args.theme) : DEFAULT_THEME;
  const ctx: ArenaChartContext = {
    document: args.document,
    theme,
    runs: args.runs,
    summaries: args.summaries,
    toolByExperiment: args.toolByExperiment,
    experimentDomain: args.experimentDomain,
    scenarioDomain: args.scenarioDomain,
  };

  return renderCharts({
    ctx,
    charts: args.charts ?? DEFAULT_CHARTS,
    configById: args.chartConfigById,
  });
}

export function createChartContext(args: {
  document: Document;
  runs: NormalizedRun[];
  summaries: ExperimentSummary[];
  toolByExperiment: ToolByExperimentRow[];
  experimentDomain: string[];
  scenarioDomain: string[];
  theme?: Partial<ArenaReportTheme>;
}): ArenaChartContext {
  const theme = args.theme ? createTheme(args.theme) : DEFAULT_THEME;
  return {
    document: args.document,
    theme,
    runs: args.runs,
    summaries: args.summaries,
    toolByExperiment: args.toolByExperiment,
    experimentDomain: args.experimentDomain,
    scenarioDomain: args.scenarioDomain,
  };
}
