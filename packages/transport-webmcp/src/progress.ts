import type { WebMCP } from 'webmcp-types';
import {
  parseVacpNarration,
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
      description: 'One plain sentence for the person.',
    },
    done: { type: 'boolean', description: 'True when this message closes the current task.' },
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
      if (record.done !== undefined && typeof record.done !== 'boolean') throw new TypeError('done must be a boolean');
      control.narrate({
        actor: options.actor,
        message: parseVacpNarration(record.message, 'message'),
        done: record.done === true,
        signal: options.signal,
      });
      return { ok: true };
    },
  };
}
