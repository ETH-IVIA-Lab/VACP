import assert from 'node:assert/strict';
import path from 'node:path';
import type { ArenaJob, PromptContext } from '../src/types.ts';

async function main() {
  process.env.VACP_ARENA_SKIP_PREFLIGHT = '1';
  const mod = await import('../agent-arena.config.ts');
  const config = mod.default;

  const baseline = firstRun(config.runs, 'baseline');
  const withSnapshot = firstRun(config.runs, 'with-snapshot');
  const fullToolkit = firstRun(config.runs, 'full-toolkit');

  assert.equal(typeof baseline.onBeforePrompt, 'function');
  assert.equal(typeof withSnapshot.onBeforePrompt, 'function');
  assert.equal(typeof fullToolkit.onBeforePrompt, 'function');

  const relativeRunOutDir =
    'runs/2026-02-11T00-00-00-000Z/runs/experiment=full-toolkit/scenario=demo/modelProvider=openai/modelName=gpt-5-4';

  const opencodeDir = path.resolve('/tmp/agent-arena-opencode');
  const artifactDir = path.resolve(opencodeDir, relativeRunOutDir);
  const artifactGlob = `"${artifactDir}/step-*.png"`;

  const baselinePrompt = renderPrompt(baseline, { opencodeDir, runOutDir: relativeRunOutDir });
  assert.ok(baselinePrompt.includes(artifactGlob));
  assert.ok(baselinePrompt.includes('including warmup step-00'));
  assert.ok(baselinePrompt.includes('Warmup already captured step-00'));
  assert.ok(!baselinePrompt.includes('screenshots you create for this run'));
  assert.ok(!baselinePrompt.includes(`"${relativeRunOutDir}/step-*.png"`));

  const withSnapshotPrompt = renderPrompt(withSnapshot, { opencodeDir, runOutDir: relativeRunOutDir });
  assert.ok(withSnapshotPrompt.includes(artifactGlob));
  assert.ok(withSnapshotPrompt.includes('including warmup step-00'));
  assert.ok(withSnapshotPrompt.includes('Warmup already captured step-00'));
  assert.ok(!withSnapshotPrompt.includes('screenshots you create for this run'));
  assert.ok(!withSnapshotPrompt.includes(`"${relativeRunOutDir}/step-*.png"`));

  const fullToolkitPrompt = renderPrompt(fullToolkit, { opencodeDir, runOutDir: relativeRunOutDir });
  assert.ok(fullToolkitPrompt.includes(artifactGlob));
  assert.ok(fullToolkitPrompt.includes(`Warmup already captured "${artifactDir}/step-00.png"`));
  assert.ok(!/First action:\s*call .*browser_screenshot.*step-00\.png/.test(fullToolkitPrompt));
  assert.ok(!fullToolkitPrompt.includes('screenshots you create for this run'));
  assert.ok(!fullToolkitPrompt.includes(`"${relativeRunOutDir}/step-*.png"`));

  console.log('agent-arena-config-prompt-contract: ok');
}

function firstRun(runs: ArenaJob[], experiment: string): ArenaJob {
  const found = runs.find((r) => r.experiment === experiment);
  assert.ok(found, `missing run for experiment=${experiment}`);

  return found;
}

function renderPrompt(
  run: ArenaJob,
  args: {
    opencodeDir: string;
    runOutDir: string;
  },
): string {
  assert.equal(typeof run.promptTemplate, 'function');

  const ctx: PromptContext = {
    scenario: run.scenario,
    job: run,
    run: {
      outDir: args.runOutDir,
      slug: 'stub-slug',
    },
    opencode: {
      directory: args.opencodeDir,
      projectID: 'project-stub',
      sessionID: 'session-stub',
    },
    tools: {},
  };

  return run.promptTemplate!(ctx);
}

void main();
