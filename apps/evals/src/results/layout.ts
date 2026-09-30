import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** One condition on one model. Conditions that call no model record `model=none`. */
export type Flow = { condition: string; model: string };

/** The `model` partition of a condition that calls no model. */
export const NO_MODEL = 'none';

const partitionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const variantPattern = /^(baseline|v\d+)$/;

/** Condition ids and model keys are Hive partition values, so they stay path-safe. */
export function assertPartition(kind: 'Condition id' | 'Model key', value: string) {
  if (!partitionPattern.test(value)) throw new Error(`${kind} "${value}" must use letters, digits, ".", "_", or "-"`);
  if (kind === 'Model key' && value === NO_MODEL)
    throw new Error(`Model key "${NO_MODEL}" names conditions without a model`);
}

export const flowLabel = (flow: Flow) =>
  flow.model === NO_MODEL ? flow.condition : `${flow.condition} · ${flow.model}`;

const flowDir = (results: string, flow: Flow) => join(results, `condition=${flow.condition}`, `model=${flow.model}`);

/** `flow.json`: what every variant of a flow shares. */
export const flowRecordPath = (results: string, flow: Flow) => join(flowDir(results, flow), 'flow.json');

/** Scenario ids contain `/`. File names use one path-safe spelling. */
const safeId = (id: string) => id.replace(/[^A-Za-z0-9._-]+/g, '--');

export type VariantPaths = ReturnType<typeof variantPaths>;

/**
 * Results are Hive-partitioned by condition, model, and variant, so one glob over `results.jsonl`
 * reads every run with those three as columns. Variants are the rounds of a hillclimb: `baseline`,
 * then `v1`, `v2`, ...
 */
export function variantPaths(results: string, flow: Flow, variant: string) {
  if (!variantPattern.test(variant)) throw new Error(`Variant "${variant}" must be baseline or v<N>`);
  const dir = join(flowDir(results, flow), `variant=${variant}`);
  const file = (folder: string, id: string, rep: number, extension: string) =>
    join(dir, folder, `${safeId(id)}_rep${rep}.${extension}`);
  return {
    dir,
    variant,
    results: join(dir, 'results.jsonl'),
    errors: join(dir, 'errors.jsonl'),
    /** Every invocation that ran into the variant: when, on which VACP code, with what condition. */
    invocations: join(dir, 'invocations.jsonl'),
    /** OpenTelemetry spans of every run, one JSON object per line, each with its run's `trace_id`. */
    spans: join(dir, 'spans.jsonl'),
    trace: (id: string, rep: number) => file('traces', id, rep, 'json'),
    /** What the checks read on each turn, so a fixed grader can re-grade without new model calls. */
    grading: (id: string, rep: number) => file('grading', id, rep, 'json'),
    screenshot: (id: string, rep: number) => file('screenshots', id, rep, 'png'),
  };
}

const partitions = (dir: string, key: string) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.startsWith(`${key}=`))
        .map((name) => name.slice(key.length + 1))
        .sort()
    : [];

/** Every approved flow under `results`, in condition and model order. */
export function flowsIn(results: string): Flow[] {
  return partitions(results, 'condition').flatMap((condition) =>
    partitions(join(results, `condition=${condition}`), 'model')
      .map((model) => ({ condition, model }))
      .filter((flow) => existsSync(flowRecordPath(results, flow))),
  );
}

/** A flow's variants, `baseline` first, then rounds in order. */
export function variantsOf(results: string, flow: Flow): string[] {
  return partitions(flowDir(results, flow), 'variant')
    .filter((variant) => variantPattern.test(variant))
    .sort((a, b) => (a === 'baseline' ? -1 : b === 'baseline' ? 1 : Number(a.slice(1)) - Number(b.slice(1))));
}
