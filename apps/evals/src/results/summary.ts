import { median, pairedDelta, wilson } from '../core/stats';
import { cost, servedAs } from '../core/usage';
import { flowLabel, flowRecordPath, variantPaths, variantsOf, type Flow } from './layout';
import type { ErrorRow, FlowRecord, ResultRow } from './rows';
import { readJson, readJsonl } from './store';

const scored = (rows: readonly ResultRow[], metric: string) =>
  rows.filter((row) => row.status === 'ok' && row.grade[metric] !== null && row.grade[metric] !== undefined);

/** Share of scored runs whose `metric` is 1. NaN without scored runs. */
export function passRate(rows: readonly ResultRow[], metric = 'pass') {
  const counted = scored(rows, metric);
  return counted.length ? counted.filter((row) => row.grade[metric] === 1).length / counted.length : Number.NaN;
}

export const percent = (value: number) => (Number.isNaN(value) ? '–' : `${Math.round(value * 100)}%`);

/** Mean of `metric` over each scenario's scored reps. Null metrics, meaning not applicable, are skipped. */
function scenarioMeans(rows: readonly ResultRow[], metric = 'pass'): Map<string, number> {
  const byScenario = new Map<string, number[]>();
  for (const row of scored(rows, metric))
    byScenario.set(row.scenario, [...(byScenario.get(row.scenario) ?? []), row.grade[metric]!]);
  return new Map(
    [...byScenario].map(([id, values]) => [id, values.reduce((sum, value) => sum + value, 0) / values.length]),
  );
}

function rate(rows: readonly ResultRow[], metric: string) {
  const counted = scored(rows, metric);
  return wilson(counted.filter((row) => row.grade[metric] === 1).length, counted.length);
}

const interval = (score: ReturnType<typeof wilson>) =>
  Number.isNaN(score.rate) ? '–' : `${percent(score.rate)} (${percent(score.lo)}–${percent(score.hi)})`;
const number = (value: number, digits = 0) => (Number.isNaN(value) ? '–' : value.toFixed(digits));
const test = (row: ResultRow) => row.split === 'test';
const train = (row: ResultRow) => row.split === 'train';

/** A markdown status table for one flow, recomputed from its rows. */
export function flowTable(results: string, flow: Flow): string {
  const record = readJson<FlowRecord>(flowRecordPath(results, flow));
  const variants = variantsOf(results, flow);
  if (!variants.length) return `${flowLabel(flow)}: no results yet`;
  const baseline = readJsonl<ResultRow>(variantPaths(results, flow, variants[0]!).results);
  const lines = [
    `### ${flowLabel(flow)}`,
    '',
    'Rates are over scored runs. Token, cost, latency, call, and read columns are medians per run.',
    '',
    '| variant | runs | pass (95% CI) | test | train | Δ test vs baseline | state | answer | guard | input tok | output tok | $/run | s/run | tool calls | read chars | errors |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const variant of variants) {
    const paths = variantPaths(results, flow, variant);
    const rows = readJsonl<ResultRow>(paths.results);
    const recorded = new Set(rows.map((row) => `${row.scenario}#${row.rep}`));
    // An error superseded by a later successful attempt no longer counts against the variant.
    const open = readJsonl<ErrorRow>(paths.errors).filter((error) => !recorded.has(`${error.scenario}#${error.rep}`));
    const byClass = Object.entries(
      open.reduce<Record<string, number>>(
        (counts, error) => ({ ...counts, [error.class]: (counts[error.class] ?? 0) + 1 }),
        {},
      ),
    );
    const paired =
      variant === variants[0]
        ? undefined
        : pairedDelta(scenarioMeans(rows.filter(test)), scenarioMeans(baseline.filter(test)));
    const delta =
      !paired || Number.isNaN(paired.mean)
        ? '–'
        : `${paired.mean >= 0 ? '+' : ''}${percent(paired.mean)} (${percent(paired.lo)}…${percent(paired.hi)})${paired.significant ? '' : ' within noise'}`;
    // A run served by another model is priced by that model's rate card, which the flow does not hold.
    const costs = rows
      .filter((row) => !record?.model_id || (row.served_model !== null && servedAs(record.model_id, row.served_model)))
      .map((row) => cost(row.usage, record?.price))
      .filter((value): value is number => value !== undefined);
    lines.push(
      [
        variant,
        rows.length,
        interval(rate(rows, 'pass')),
        percent(passRate(rows.filter(test))),
        percent(passRate(rows.filter(train))),
        delta,
        percent(passRate(rows, 'state')),
        percent(passRate(rows, 'answer')),
        percent(passRate(rows, 'guard')),
        number(median(rows.map((row) => row.usage.input + row.usage.cache_read + row.usage.cache_write))),
        number(median(rows.map((row) => row.usage.output))),
        costs.length ? `$${median(costs).toFixed(4)}` : 'no price',
        number(median(rows.map((row) => row.latency_s)), 1),
        number(median(rows.map((row) => row.tool_calls)), 1),
        number(median(rows.map((row) => row.read_chars))),
        byClass.length ? byClass.map(([kind, count]) => `${count} ${kind}`).join(', ') : '0',
      ]
        .join(' | ')
        .replace(/^/, '| ')
        .replace(/$/, ' |'),
    );
  }
  return lines.join('\n');
}
