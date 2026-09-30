import type { ChatTransport, UIMessage } from 'ai';
import type { AgentTurns } from './agent-turn';

/**
 * Open the turn when a chat request is sent, so presentation shows its waiting state until the model
 * speaks. The agent closes the turn as its request ends. The transport closes it when the request
 * fails before reaching the agent, its stream breaks, or the consumer cancels it.
 */
export function withAgentActivity<Message extends UIMessage>(
  transport: ChatTransport<Message>,
  turns: AgentTurns,
): ChatTransport<Message> {
  return {
    reconnectToStream: (options) => transport.reconnectToStream(options),
    async sendMessages(options) {
      turns.begin(options.abortSignal);
      try {
        const reader = (await transport.sendMessages(options)).getReader();
        return new ReadableStream({
          async pull(controller) {
            try {
              const next = await reader.read();
              if (next.done) controller.close();
              else controller.enqueue(next.value);
            } catch (error) {
              turns.end('failed');
              controller.error(error);
            }
          },
          cancel(reason) {
            turns.end('cancelled');
            return reader.cancel(reason);
          },
        });
      } catch (error) {
        turns.end('failed');
        throw error;
      }
    },
  };
}
