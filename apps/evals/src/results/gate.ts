import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { Split } from '../core/split';
import type { ResolvedModel } from '../ports';
import type { Suite } from '../suite';
import { flowLabel, flowRecordPath, type Flow } from './layout';
import type { FlowRecord } from './rows';
import { readJson, writeJson } from './store';

/** The eval's own code or split changed since a flow was approved, or its packages are stale. Exits with code 2. */
export class EvalGateError extends Error {
  override name = 'EvalGateError';
}

function files(root: string, path: string): string[] {
  const absolute = join(root, path);
  if (!existsSync(absolute)) return [];
  if (!statSync(absolute).isDirectory()) return [path];
  return readdirSync(absolute, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.parentPath.includes('node_modules'))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)));
}

/**
 * Digest of the eval's own code and dependencies. A hillclimb round changes VACP, never these, so a
 * changed digest stops the next run until someone approves the change.
 */
function evalDigest(root: string, paths: readonly string[]): string {
  const hash = createHash('sha256');
  for (const file of paths.flatMap((path) => files(root, path)).sort())
    hash
      .update(file)
      .update('\0')
      .update(
        createHash('sha256')
          .update(readFileSync(join(root, file)))
          .digest('hex'),
      );
  return hash.digest('hex');
}

const sameIds = (a: readonly string[], b: readonly string[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The flow's record, created once. It holds the split and the eval's own code fixed across rounds: a
 * changed split always stops the run, and changed eval code stops it unless `approve` re-bases it.
 */
export function approveFlow(input: {
  suite: Suite;
  flow: Flow;
  model: ResolvedModel | undefined;
  split: Split;
  approve: boolean;
}): FlowRecord {
  const { suite, flow, split } = input;
  const path = flowRecordPath(suite.results, flow);
  const existing = readJson<FlowRecord>(path);
  const label = flowLabel(flow);
  if (existing && (!sameIds(existing.split.train, split.train) || !sameIds(existing.split.test, split.test)))
    throw new EvalGateError(
      `The split in ${suite.splitFile} differs from the one ${label} was scored on. Splits are fixed once.`,
    );
  const sha = evalDigest(suite.repoRoot, suite.evalPaths);
  if (existing?.eval.sha === sha) return existing;
  if (!input.approve)
    throw new EvalGateError(
      existing
        ? `The eval code changed since ${label} was approved. Review the change, then rerun with --approve-eval.`
        : `${label} has no approved eval code yet. Review the runner, graders, and scenarios, then rerun with --approve-eval.`,
    );
  const record: FlowRecord = {
    ...flow,
    model_id: input.model?.id ?? null,
    // The flow's rep count is the suite's. `--reps` sizes one invocation, such as a one-rep pilot.
    reps: existing?.reps ?? suite.run.reps,
    split: { train: split.train, test: split.test },
    price: input.model?.price,
    eval: { paths: suite.evalPaths, sha },
  };
  writeJson(path, record);
  return record;
}

/** Re-base an approved flow on the current eval code, as regrading its rows does. */
export function rebaseFlow(suite: Suite, flow: Flow) {
  const path = flowRecordPath(suite.results, flow);
  const record = readJson<FlowRecord>(path);
  if (record)
    writeJson(path, { ...record, eval: { paths: suite.evalPaths, sha: evalDigest(suite.repoRoot, suite.evalPaths) } });
}
