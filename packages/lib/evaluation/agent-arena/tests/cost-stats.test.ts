import assert from 'node:assert/strict';
import { computeExperimentSummaries, computeScenarioExperimentSummaries, normalizeRuns } from '../src/report/stats.js';

function main() {
  const rows = [
    {
      run_id: 'r1',
      experiment: 'baseline',
      scenario_id: 's1',
      model_provider: 'openai',
      model_name: 'gpt-5.2',
      ok: true,
      plumbing_ok: true,
      answer_parse_status: 'ok',
      solved_strict: true,
      solved_semantic: true,
      cost_provider_usd: 1.2,
      cost_estimated_usd: 1.1,
      cost_usd: 1.2,
      cost_basis: 'provider_reported',
      tokens_input: 10,
      tokens_output: 20,
      tokens_reasoning: 5,
      tokens_cache_read: 3,
      tokens_cache_write: 1,
    },
    {
      run_id: 'r2',
      experiment: 'baseline',
      scenario_id: 's1',
      model_provider: 'openai',
      model_name: 'gpt-5.2',
      ok: true,
      plumbing_ok: true,
      answer_parse_status: 'ok',
      solved_strict: true,
      solved_semantic: true,
      cost_provider_usd: 0,
      cost_estimated_usd: 2.4,
      cost_usd: 2.4,
      cost_basis: 'model_pricing',
      tokens_input: 30,
      tokens_output: 40,
      tokens_reasoning: 10,
      tokens_cache_read: 4,
      tokens_cache_write: 2,
    },
    {
      run_id: 'r3',
      experiment: 'full-toolkit',
      scenario_id: 's2',
      model_provider: 'openai',
      model_name: 'gpt-5.2',
      ok: false,
      plumbing_ok: false,
      answer_parse_status: 'no_json_fence',
      solved_strict: null,
      solved_semantic: null,
      // Cost-only rows remain supported for archived analysis exports.
      cost: 3.6,
      tokens_input: 5,
      tokens_output: 5,
      tokens_reasoning: 0,
      tokens_cache_read: 0,
      tokens_cache_write: 0,
    },
  ];

  const normalized = normalizeRuns(rows);
  assert.equal(normalized.length, 3);

  assert.equal(normalized[0].costProviderUsd, 1.2);
  assert.equal(normalized[0].costEstimatedUsd, 1.1);
  assert.equal(normalized[0].costUsd, 1.2);
  assert.equal(normalized[0].costBasis, 'provider_reported');

  assert.equal(normalized[1].costProviderUsd, 0);
  assert.equal(normalized[1].costEstimatedUsd, 2.4);
  assert.equal(normalized[1].costUsd, 2.4);
  assert.equal(normalized[1].costBasis, 'model_pricing');

  assert.equal(normalized[2].costProviderUsd, 3.6);
  assert.equal(normalized[2].costEstimatedUsd, null);
  assert.equal(normalized[2].costUsd, 3.6);
  assert.equal(normalized[2].costBasis, 'provider_reported');

  const exp = computeExperimentSummaries(normalized);
  const baseline = exp.find((x) => x.experiment === 'baseline');
  const fullToolkit = exp.find((x) => x.experiment === 'full-toolkit');
  assert.ok(baseline);
  assert.ok(fullToolkit);
  assert.ok(Math.abs((baseline.costTotalUsd ?? 0) - 3.6) < 1e-9);
  assert.ok(Math.abs((baseline.costMedianUsd ?? 0) - 1.8) < 1e-9);
  assert.equal(fullToolkit.costTotalUsd, 3.6);
  assert.equal(fullToolkit.costMedianUsd, 3.6);

  const scenario = computeScenarioExperimentSummaries(normalized);
  const s1Baseline = scenario.find((x) => x.scenarioId === 's1' && x.experiment === 'baseline');
  assert.ok(s1Baseline);
  assert.ok(Math.abs((s1Baseline.costTotalUsd ?? 0) - 3.6) < 1e-9);
  assert.ok(Math.abs((s1Baseline.costMedianUsd ?? 0) - 1.8) < 1e-9);

  console.log('cost-stats: ok');
}

main();
