import { createScenarioMetricHeatmapChart } from './scenario-metric-heatmap.js';
import { fmtCompact, fmtNumber } from './utils.js';

export const scenarioTokensHeatmapWithCacheAllChart = createScenarioMetricHeatmapChart({
  id: 'scenario-tokens-heatmap-with-cache-all',
  title: 'Task by Experiment — Median Tokens (With Cache All)',
  caption:
    'Median per-task tokens using the explicit with-cache-all basis (input + output + reasoning + cache read + cache write).',
  valueLabel: 'Median tokens (with cache all)',
  getValue: (r) => r.tokensTotalWithCacheAll,
  formatCell: (v) => fmtCompact(v),
  formatTitle: (v) => `${fmtNumber(Math.round(v))} tokens`,
  aggregate: 'median',
});

export const scenarioTokensHeatmapWithCacheReadChart = createScenarioMetricHeatmapChart({
  id: 'scenario-tokens-heatmap-with-cache-read',
  title: 'Task by Experiment — Median Tokens (With Cache Read)',
  caption: 'Median per-task tokens using the explicit with-cache-read basis (input + output + reasoning + cache read).',
  valueLabel: 'Median tokens (with cache read)',
  getValue: (r) => r.tokensTotalWithCacheRead,
  formatCell: (v) => fmtCompact(v),
  formatTitle: (v) => `${fmtNumber(Math.round(v))} tokens`,
  aggregate: 'median',
});

export const scenarioTokensHeatmapNoCacheChart = createScenarioMetricHeatmapChart({
  id: 'scenario-tokens-heatmap-no-cache',
  title: 'Task by Experiment — Median Tokens (No Cache)',
  caption: 'Median per-task tokens using the explicit no-cache basis (input + output + reasoning).',
  valueLabel: 'Median tokens (no cache)',
  getValue: (r) => r.tokensTotalNoCache,
  formatCell: (v) => fmtCompact(v),
  formatTitle: (v) => `${fmtNumber(Math.round(v))} tokens`,
  aggregate: 'median',
});
