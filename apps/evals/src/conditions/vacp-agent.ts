import { createVacpToolLoopAgent, defaultVacpAgentInstructions, vacpAgentDefaults } from '@ethivia/vacp-ai';
import { vacpAgentTools } from '@ethivia/vacp-sdk/agent';
import type { ModelMessage } from 'ai';

import type { Condition } from '../ports';

export type VacpAgentConditionOptions = {
  /** Replaces the product's default instructions, for rounds that tune them. */
  instructions?: string;
  temperature?: number;
};

/**
 * VACP's own agent, `createVacpToolLoopAgent`, driving the page's runtime as an application wires it:
 * the `vacp_*` tools over the in-page bridge, with the suite's model. Each request is one turn.
 */
export function vacpAgentCondition(options: VacpAgentConditionOptions = {}): Condition {
  const instructions = options.instructions ?? defaultVacpAgentInstructions;
  const temperature = options.temperature ?? vacpAgentDefaults.temperature;
  return {
    kind: 'agent',
    async start({ model }) {
      return {
        description: {
          loop: '@ethivia/vacp-ai createVacpToolLoopAgent',
          instructions,
          tools: Object.keys(vacpAgentTools).join(', '),
          settings: { temperature },
        },
        async conversation({ page, signal, maxSteps, telemetry }) {
          const agent = createVacpToolLoopAgent({
            model: model.language,
            runtime: page.bridge,
            instructions,
            maxSteps,
            temperature,
            providerOptions: model.options,
            telemetry: telemetry(),
          });
          const messages: ModelMessage[] = [];
          return {
            async say(message) {
              messages.push({ role: 'user', content: message });
              const result = await agent.generate({ messages, abortSignal: signal });
              messages.push(...result.response.messages);
              const stop =
                result.finishReason === 'length'
                  ? 'length'
                  : result.finishReason === 'tool-calls'
                    ? 'max-steps'
                    : 'done';
              return { text: result.text, stop };
            },
          };
        },
      };
    },
  };
}
