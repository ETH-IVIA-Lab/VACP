import { createScenarioMetricHeatmapChart } from './scenario-metric-heatmap.js';
import { fmtCompact, fmtNumber } from './utils.js';

export const scenarioTokensHeatmapChart = createScenarioMetricHeatmapChart({
  id: 'scenario-tokens-heatmap',
  title: 'Task × Experiment (Median Tokens)',
  caption:
    'Median tokens (no cache) per task. Cell text is a compact value; hover for exact counts. X-axis labels are task indices.',
  valueLabel: 'Median tokens',
  getValue: (r) => r.tokensTotalNoCache,
  formatCell: (v) => fmtCompact(v),
  formatTitle: (v) => `${fmtNumber(Math.round(v))} tokens`,
  aggregate: 'median',
});
