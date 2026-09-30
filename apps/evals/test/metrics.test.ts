import assert from 'node:assert/strict';
import test from 'node:test';
import { runMetrics } from '../src/core/metrics';
import type { ExecutionRecord } from '../src/core/scenario';
import { Trace } from '../src/core/trace';

const execution = (id: string, startMs: number, endMs: number): ExecutionRecord => ({
  id,
  name: 'cohort.set_sex',
  operation: 'mutation',
  actor: 'agent',
  phase: 'succeeded',
  phases: [
    { phase: 'accepted', at: new Date(startMs).toISOString() },
    { phase: 'succeeded', at: new Date(endMs).toISOString() },
  ],
});

test('latency counts the turns, and action time comes from the runtime’s execution phases', () => {
  const trace = new Trace();
  trace.beginTurn('Filter.');
  trace.toolCall('vacp_state', {});
  trace.toolResult('vacp_state', '{"state":{}}', 5, true);
  trace.toolCall('vacp_execute', {});
  trace.toolResult('vacp_execute', '{"ok":false}', 900, true);
  const metrics = runMetrics({
    trace,
    executions: [execution('a', 0, 40), execution('b', 1_000, 1_100), execution('c', 2_000, 2_060)],
    turnMs: [1_250, 750],
  });
  assert.equal(metrics.latency_s, 2);
  assert.equal(metrics.action_ms, 60);
  assert.equal(metrics.read_chars, '{"state":{}}'.length);
  assert.equal(metrics.tool_errors, 1, 'a failed VACP envelope counts as a tool error');
  assert.equal(metrics.catalog_changes, null, 'a condition with fixed tools reports no catalog');
});
