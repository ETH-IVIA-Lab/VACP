import type { VacpActor } from '@vacp/protocol';

import type { Condition } from '../ports';

const oracleActor: VacpActor = { id: 'oracle', kind: 'agent', label: 'Oracle' };

/**
 * Plays each turn's reference solution as the agent. Every scenario must pass under it: a failure
 * means a broken check, a wrong gold answer, or a task VACP cannot express.
 */
export function oracleCondition(): Condition {
  return {
    kind: 'oracle',
    async start() {
      return {
        description: { loop: 'scenario reference solutions', tools: 'VACP actions' },
        async conversation({ page, scenario, trace }) {
          let turn = 0;
          return {
            async say() {
              const { oracle } = scenario.turns[turn++]!;
              for (const step of oracle.steps ?? []) {
                trace.toolCall(step.action, step.params);
                const started = performance.now();
                const result = await page.act(step, oracleActor);
                trace.toolResult(step.action, JSON.stringify(result ?? null), performance.now() - started, true);
              }
              trace.assistant(oracle.answer);
              return { text: oracle.answer, stop: 'done' };
            },
          };
        },
      };
    },
  };
}

/** Does nothing and says nothing. A scenario that passes under it measures its grader, not the agent. */
export function controlCondition(): Condition {
  return {
    kind: 'control',
    async start() {
      return {
        description: { loop: 'no agent', tools: 'none' },
        async conversation() {
          return { say: async () => ({ text: '', stop: 'done' }) };
        },
      };
    },
  };
}
