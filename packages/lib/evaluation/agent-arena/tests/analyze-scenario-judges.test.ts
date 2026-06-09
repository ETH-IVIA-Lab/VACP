import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadScenarioJudges } from '../src/analyze/analyze-run.ts';

async function main() {
  process.env.VACP_ARENA_SKIP_PREFLIGHT = '1';

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-arena-derived-config-'));
  const configPath = path.join(tempDir, 'focused.config.ts');
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const baseConfigUrl = pathToFileURL(path.join(packageRoot, 'agent-arena.config.ts')).href;

  await fs.writeFile(
    configPath,
    [
      `import baseConfig from ${JSON.stringify(baseConfigUrl)};`,
      "const TARGET_EXPERIMENTS = new Set(['plain-mcp']);",
      'export default {',
      '  ...baseConfig,',
      '  runs: baseConfig.runs.filter((run) => TARGET_EXPERIMENTS.has(run.experiment)),',
      '};',
      '',
    ].join('\n'),
    'utf8',
  );

  const scoring = await loadScenarioJudges(configPath);
  assert.ok(scoring);
  assert.ok(scoring.scenariosPath?.endsWith('agent-arena.scenarios.ts'));
  assert.equal(typeof scoring.judges.get('vl-global-development-t1-lifeexp-max-2000'), 'function');
  assert.equal(scoring.pricingByModel.has('openai::gpt-5.4'), true);

  const judge = scoring.judges.get('vl-global-development-t1-lifeexp-max-2000') as (args: {
    scenarioId: string;
    answer: unknown;
    parseStatus: string;
  }) => { ok: boolean };

  const result = judge({
    scenarioId: 'vl-global-development-t1-lifeexp-max-2000',
    answer: { country: 'Japan', lifeExpectancy: 81.6 },
    parseStatus: 'ok',
  });
  assert.equal(result.ok, true);

  console.log('analyze-scenario-judges: ok');
}

void main();
