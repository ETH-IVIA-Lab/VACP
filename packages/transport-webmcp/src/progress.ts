import type { WebMCP } from 'webmcp-types';
import {
  parseVacpNarration,
  vacpProgressFields,
  vacpProgressGuidance,
  VACP_NARRATION_MAX_LENGTH,
  type VacpActor,
  type VacpAgentActivityControl,
} from '@vacp/protocol';
import { webMcpExecutionSignal } from './execution';

const progressInputSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    message: {
      type: 'string',
      minLength: 1,
      maxLength: VACP_NARRATION_MAX_LENGTH,
      description: vacpProgressFields.message,
    },
    done: { type: 'boolean', description: vacpProgressFields.done },
  },
  required: ['message'],
  additionalProperties: false,
};

/** The progress tool: the agent's opening and closing sentences, spoken through the runtime's narrator. */
export function createVacpWebMcpProgressTool(
  control: Pick<VacpAgentActivityControl, 'narrate'>,
  options: { actor: VacpActor; name: string; signal: AbortSignal },
): WebMCP.ModelContextTool {
  return {
    name: options.name,
    title: 'Tell the person what you are doing',
    description: vacpProgressGuidance,
    inputSchema: progressInputSchema,
    execute: (input, context) => {
      webMcpExecutionSignal(context).throwIfAborted();
      options.signal.throwIfAborted();
      const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
      let message: string;
      try {
        if (record.done !== undefined && typeof record.done !== 'boolean')
          throw new TypeError('done must be a boolean');
        message = parseVacpNarration(record.message, 'message');
      } catch (error) {
        // Browsers withhold a tool's thrown message from the agent, so the failure is its result.
        return { ok: false, error: { message: (error as Error).message } };
      }
      control.narrate({ actor: options.actor, message, done: record.done === true, signal: options.signal });
      return { ok: true };
    },
  };
}
