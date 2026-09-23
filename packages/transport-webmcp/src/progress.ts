import type { WebMCP } from 'webmcp-types';
import type { VacpActor, VacpAgentActivityControl, VacpAgentActivityHandle } from '@vacp/protocol';
import { webMcpExecutionSignal } from './execution';

/** Guidance shared by every VACP transport that lets an agent narrate for the person watching. */
export const vacpProgressDescription = [
  'Tell the person what you are doing, in one short plain sentence they can read on screen while you work.',
  'Speak to them directly in the present tense about the data and the view, and add the reason when it helps them follow, for example "Narrowing to sprinters under 25 to compare medalists at their peak age".',
  'Leave out tool names, references, ids, and remarks about yourself.',
  'Call it before each action and again when the picture changes. Set done to true with a brief closing sentence that states what the view now shows.',
].join(' ');

export type VacpProgressInput = { message: string; done?: boolean };

export function parseVacpProgressInput(input: unknown): VacpProgressInput {
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const message = typeof record.message === 'string' ? record.message.trim() : '';
  if (!message) throw new TypeError('progress requires a message');
  if (message.length > 280) throw new TypeError('progress messages are at most 280 characters');
  if (record.done !== undefined && typeof record.done !== 'boolean') throw new TypeError('done must be a boolean');
  return { message, done: record.done === true };
}

export const vacpProgressInputSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    message: { type: 'string', minLength: 1, maxLength: 280, description: 'One plain sentence for the person.' },
    done: { type: 'boolean', description: 'True when this message closes the current task.' },
  },
  required: ['message'],
  additionalProperties: false,
};

/**
 * One public activity per agent turn. The first message opens it, later messages replace its text,
 * `done` closes it, and a quiet spell closes it so a forgotten turn cannot stay on screen.
 */
export function createVacpWebMcpProgressTool(
  control: VacpAgentActivityControl,
  options: { actor: VacpActor; name: string; signal: AbortSignal; idleMs?: number },
): WebMCP.ModelContextTool {
  const idleMs = options.idleMs ?? 15_000;
  let turn: VacpAgentActivityHandle | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const close = (outcome: 'completed' | 'cancelled', summary?: string) => {
    clearTimeout(idle);
    idle = undefined;
    turn?.end({ outcome, summary });
    turn = undefined;
  };
  options.signal.addEventListener('abort', () => close('cancelled'), { once: true });
  return {
    name: options.name,
    title: 'Tell the person what you are doing',
    description: vacpProgressDescription,
    inputSchema: vacpProgressInputSchema,
    execute: (input, context) => {
      webMcpExecutionSignal(context).throwIfAborted();
      options.signal.throwIfAborted();
      const { message, done } = parseVacpProgressInput(input);
      if (done) {
        if (turn) close('completed', message);
        else control.beginAgentActivity({ actor: options.actor, signal: options.signal }).end({ summary: message });
        return { ok: true };
      }
      if (turn) turn.update(message);
      else turn = control.beginAgentActivity({ actor: options.actor, summary: message, signal: options.signal });
      clearTimeout(idle);
      idle = setTimeout(() => close('completed'), idleMs);
      return { ok: true };
    },
  };
}
