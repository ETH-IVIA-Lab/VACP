import { createScenarioMetricHeatmapChart } from './scenario-metric-heatmap.js';
import { fmtNumber } from './utils.js';

export const scenarioDurationHeatmapChart = createScenarioMetricHeatmapChart({
  id: 'scenario-duration-heatmap',
  title: 'Task × Experiment (Median Duration)',
  caption: 'Median run duration (seconds) per task. X-axis labels are task indices (see “Task Index” table).',
  valueLabel: 'Median duration',
  getValue: (r) => r.durationS,
  formatCell: (v) => fmtNumber(Math.round(v)),
  formatTitle: (v) => `${fmtNumber(Math.round(v))}s`,
  aggregate: 'median',
});
