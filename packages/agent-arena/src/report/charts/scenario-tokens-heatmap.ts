import { createScenarioMetricHeatmapChart } from './scenario-metric-heatmap.js';
import { fmtCompact, fmtNumber } from './utils.js';

export const scenarioTokensHeatmapChart = createScenarioMetricHeatmapChart({
  id: 'scenario-tokens-heatmap',
  title: 'Task by Experiment — Median Tokens with Cache',
  caption: 'Median with-cache tokens per task. X-axis numbers map to the Task Index table.',
  valueLabel: 'Median tokens with cache',
  getValue: (r) => r.tokensTotalWithCacheAll ?? r.tokensTotalWithCacheRead ?? r.tokensTotalNoCache,
  formatCell: (v) => fmtCompact(v),
  formatTitle: (v) => `${fmtNumber(Math.round(v))} tokens`,
  aggregate: 'median',
});
