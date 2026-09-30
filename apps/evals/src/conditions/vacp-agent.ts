import {
  buildVacpAgentInstructions,
  createVacpToolLoopAgent,
  vacpAgentDefaults,
  type VacpAgentInteractionPolicy,
} from '@vacp/agent-ai-sdk';
import { vacpAgentTools } from '@vacp/protocol';
import { createVacpTransport } from '@vacp/transport-bridge';
import type { ModelMessage } from 'ai';

import type { Condition } from '../ports';

export type VacpAgentConditionOptions = {
  /** Replaces the product's default instructions, for rounds that tune them. */
  instructions?: string;
  interactionPolicy?: VacpAgentInteractionPolicy;
  temperature?: number;
};

/**
 * VACP's own agent, `createVacpToolLoopAgent`, driving the page's runtime through the transport an
 * application wires: the `vacp_*` tools over the in-page bridge, with the suite's model.
 */
export function vacpAgentCondition(options: VacpAgentConditionOptions = {}): Condition {
  const instructions = buildVacpAgentInstructions({
    baseInstructions: options.instructions,
    interactionPolicy: options.interactionPolicy,
  });
  const temperature = options.temperature ?? vacpAgentDefaults.temperature;
  return {
    kind: 'agent',
    async start({ model }) {
      return {
        description: {
          loop: '@vacp/agent-ai-sdk createVacpToolLoopAgent',
          instructions,
          tools: Object.keys(vacpAgentTools).join(', '),
          settings: { temperature, interactionPolicy: options.interactionPolicy },
        },
        async conversation({ page, signal, maxSteps, telemetry }) {
          const agent = createVacpToolLoopAgent({
            model: model.language,
            transport: createVacpTransport(page.bridge),
            activity: page.bridge,
            instructions: options.instructions,
            interactionPolicy: options.interactionPolicy,
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
