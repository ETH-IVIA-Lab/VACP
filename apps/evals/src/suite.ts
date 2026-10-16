import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ServeMode } from './adapters/browser/serve';
import { createModels } from './adapters/models';
import type { Scenario } from './core/scenario';
import type { Split } from './core/split';
import type { Condition, ModelConfig, ProviderConfig, ResolvedModel } from './ports';
import { assertPartition } from './results/layout';

export type RunDefaults = {
  /** Repetitions per case. Three keeps a binary rate's noise near ±10 points on 32 cases. */
  reps: number;
  /** Browser contexts working at once. */
  concurrency: number;
  /** Hard wall-clock ceiling per run, independent of stream liveness. */
  timeoutS: number;
  /** Model calls per turn before the run stops as `max-steps`. */
  maxSteps: number;
  /** How the gallery is served when no base URL is given. */
  serve: ServeMode;
  port: number;
};

export type SuiteInput = {
  providers: Readonly<Record<string, ProviderConfig>>;
  models: Readonly<Record<string, ModelConfig>>;
  defaultModel: string;
  /** Conditions by id. The id names the condition's results partition. */
  conditions: Readonly<Record<string, Condition>>;
  defaultCondition: string;
  scenarios: readonly Scenario[];
  run?: Partial<RunDefaults>;
  /** Where conditions keep sandboxes and runtime installs. Defaults to `~/.cache/vacp-evals`. */
  workspaces?: string;
};

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export type Suite = Omit<SuiteInput, 'run' | 'workspaces'> & {
  run: RunDefaults;
  repoRoot: string;
  /** Results, partitioned as `condition=<id>/model=<key>/variant=<name>`. */
  results: string;
  /** The fixed train/test split. */
  splitFile: string;
  /** The split, once drawn. */
  split(): Split | undefined;
  /** Repository-relative paths of the eval's own code and dependencies, digested by the eval gate. */
  evalPaths: string[];
  /** One directory per condition, outside the repository. */
  workspace(condition: string): string;
  model(key: string): ResolvedModel;
};

export function defineSuite(input: SuiteInput): Suite {
  const ids = input.scenarios.map((scenario) => scenario.id);
  const repeated = ids.find((id, index) => ids.indexOf(id) !== index);
  if (repeated) throw new Error(`Scenario id "${repeated}" is declared twice`);
  for (const id of Object.keys(input.conditions)) assertPartition('Condition id', id);
  for (const key of Object.keys(input.models)) assertPartition('Model key', key);
  if (!input.conditions[input.defaultCondition])
    throw new Error(`Default condition "${input.defaultCondition}" is not configured`);
  if (!input.models[input.defaultModel]) throw new Error(`Default model "${input.defaultModel}" is not configured`);
  const { run, workspaces, ...rest } = input;
  const cache = workspaces ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'vacp-evals');
  const splitFile = join(appRoot, 'split.json');
  return {
    ...rest,
    run: { reps: 3, concurrency: 4, timeoutS: 420, maxSteps: 16, serve: 'dev', port: 4480, ...run },
    repoRoot: resolve(appRoot, '../..'),
    results: join(appRoot, 'results'),
    splitFile,
    split: () => (existsSync(splitFile) ? (JSON.parse(readFileSync(splitFile, 'utf8')) as Split) : undefined),
    evalPaths: [
      'apps/evals/src',
      'apps/evals/scenarios',
      'apps/evals/evals.config.ts',
      'apps/evals/package.json',
      'patches',
      'pnpm-workspace.yaml',
    ],
    workspace: (condition) => join(cache, condition),
    model: createModels(input.providers, input.models),
  };
}
