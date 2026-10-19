import { createVacpToolLoopAgent, defaultVacpAgentInstructions, vacpAgentDefaults } from '@ethivia/vacp-ai-sdk';
import { vacpAgentActor, vacpAgentTools } from '@ethivia/vacp-protocol';
import { createVacpTransport } from '@ethivia/vacp-bridge';
import type { ModelMessage } from 'ai';

import type { Condition } from '../ports';

export type VacpAgentConditionOptions = {
  /** Replaces the product's default instructions, for rounds that tune them. */
  instructions?: string;
  temperature?: number;
};

/**
 * VACP's own agent, `createVacpToolLoopAgent`, driving the page's runtime through the transport an
 * application wires: the `vacp_*` tools over the in-page bridge, with the suite's model.
 */
export function vacpAgentCondition(options: VacpAgentConditionOptions = {}): Condition {
  const instructions = options.instructions ?? defaultVacpAgentInstructions;
  const temperature = options.temperature ?? vacpAgentDefaults.temperature;
  return {
    kind: 'agent',
    async start({ model }) {
      return {
        description: {
          loop: '@ethivia/vacp-ai-sdk createVacpToolLoopAgent',
          instructions,
          tools: Object.keys(vacpAgentTools).join(', '),
          settings: { temperature },
        },
        async conversation({ page, signal, maxSteps, telemetry }) {
          const agent = createVacpToolLoopAgent({
            model: model.language,
            transport: createVacpTransport(page.bridge),
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
              // One request is one turn: the model's sentences and steps join it, and its outcome closes it.
              const turn = page.bridge.beginAgentActivity({ actor: vacpAgentActor });
              let outcome: 'completed' | 'failed' | 'cancelled' = 'failed';
              let result: Awaited<ReturnType<typeof agent.generate>>;
              try {
                result = await agent.generate({ messages, abortSignal: signal });
                outcome = 'completed';
              } catch (error) {
                if (signal.aborted) outcome = 'cancelled';
                throw error;
              } finally {
                turn.end({ outcome });
              }
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
