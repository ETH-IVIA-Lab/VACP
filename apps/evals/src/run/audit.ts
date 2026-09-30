import { rmSync } from 'node:fs';
import { join } from 'node:path';

import type { Tracing } from '../adapters/telemetry';
import type { Scenario } from '../core/scenario';
import { flowLabel } from '../results/layout';
import type { ResultRow } from '../results/rows';
import { readJsonl } from '../results/store';
import type { Suite } from '../suite';
import { runFlow } from './flow';

/**
 * Run every oracle and control condition over `scenarios`, one rep each, from scratch. A scenario is
 * sound when every oracle passes it and every control fails it. Returns the number of unsound ones.
 */
export async function auditScenarios(input: {
  suite: Suite;
  tracing: Tracing;
  scenarios: readonly Scenario[];
  baseURL?: string;
  log(line: string): void;
  signal: AbortSignal;
}): Promise<number> {
  const { suite, scenarios, log } = input;
  const roles = Object.entries(suite.conditions).flatMap(([id, condition]) =>
    condition.kind === 'oracle' || condition.kind === 'control' ? [{ id, kind: condition.kind }] : [],
  );
  const outcomes = new Map<
    string,
    Array<{ id: string; kind: 'oracle' | 'control'; row?: ResultRow; errors: string }>
  >();
  for (const role of roles) {
    // Audits are diagnostics, rerun from scratch whenever scenarios change.
    rmSync(join(suite.results, `condition=${role.id}`), { recursive: true, force: true });
    const { flow, paths } = await runFlow({
      ...input,
      condition: role.id,
      variant: 'baseline',
      reps: 1,
      approveEval: true,
    });
    const rows = readJsonl<ResultRow>(paths.results);
    for (const scenario of scenarios)
      outcomes.set(scenario.id, [
        ...(outcomes.get(scenario.id) ?? []),
        { ...role, row: rows.find((row) => row.scenario === scenario.id), errors: `${flowLabel(flow)} errors.jsonl` },
      ]);
  }
  let problems = 0;
  for (const [id, results] of outcomes) {
    const issues = results.flatMap(({ id: condition, kind, row, errors }) => {
      if (kind === 'oracle' && !row) return [`${condition} errored (see ${errors})`];
      if (kind === 'oracle' && row!.grade.pass !== 1) return [`${condition} fails: ${row!.explanation.pass}`];
      if (kind === 'control' && row?.grade.pass === 1)
        return [`passes under ${condition}: the checks do not require the task to be done`];
      return [];
    });
    if (issues.length) problems++;
    log(`${issues.length ? 'FAIL' : 'ok  '} ${id}${issues.length ? `\n     ${issues.join('\n     ')}` : ''}`);
  }
  log(`\n${outcomes.size - problems}/${outcomes.size} scenarios pass under every oracle and fail under every control`);
  return problems;
}
