import { gradeTurn, summarize, type CheckResult, type GradingRecord } from '../core/grade';
import { promptOf } from '../core/scenario';
import type { Suite } from '../suite';
import { rebaseFlow } from './gate';
import { flowLabel, variantPaths, variantsOf, type Flow } from './layout';
import type { ResultRow } from './rows';
import { holdLock, readJson, readJsonl, writeJsonl } from './store';
import { passRate, percent } from './summary';

/**
 * Grade every recorded run of a flow again with the current checks, from the grading inputs the run
 * stored: replies, state, executions, and the rendered text checks read. No model is called. A view
 * check on a selector the original checks never read sees `null`, so a new view check needs a rerun.
 * A row recorded for an earlier wording of its scenario keeps its grade until `run` replaces it.
 */
export async function regradeFlow(suite: Suite, flow: Flow, log: (line: string) => void) {
  const scenarios = new Map(suite.scenarios.map((scenario) => [scenario.id, scenario]));
  for (const variant of variantsOf(suite.results, flow)) {
    const paths = variantPaths(suite.results, flow, variant);
    const release = holdLock(paths.lock, `${flowLabel(flow)} / ${variant}`);
    try {
      const rows = readJsonl<ResultRow>(paths.results);
      const next: ResultRow[] = [];
      let changed = 0;
      let kept = 0;
      let reworded = 0;
      for (const row of rows) {
        const scenario = scenarios.get(row.scenario);
        if (scenario && promptOf(scenario) !== row.prompt) {
          reworded++;
          next.push(row);
          continue;
        }
        const record = scenario && readJson<GradingRecord>(paths.grading(scenario.id, row.rep));
        if (!scenario || !record || record.turns.length !== scenario.turns.length) {
          kept++;
          next.push(row);
          continue;
        }
        const checks: CheckResult[] = [];
        for (const index of scenario.turns.keys())
          checks.push(
            ...(await gradeTurn(
              scenario,
              record,
              index,
              async (selector) => record.turns[index]!.texts[selector] ?? null,
            )),
          );
        const { grade, explanation } = summarize(checks);
        if (JSON.stringify(grade) !== JSON.stringify(row.grade)) changed++;
        next.push({ ...row, grade, explanation, checks });
      }
      writeJsonl(paths.results, next);
      log(
        `${flowLabel(flow)} / ${variant}: ${changed} of ${rows.length} rows changed grade, pass ${percent(passRate(rows))} → ${percent(passRate(next))}` +
          (kept ? `, ${kept} rows without matching grading inputs kept as scored` : '') +
          (reworded ? `, ${reworded} rows of reworded scenarios kept until \`run\` replaces them` : ''),
      );
    } finally {
      release();
    }
  }
  rebaseFlow(suite, flow);
}
