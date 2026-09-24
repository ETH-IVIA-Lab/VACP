import type { ChatTransport, UIMessage } from 'ai';
import type { AgentTurns } from './agent-turn';

/** Observe public stream lifecycle markers; never forward reasoning or response text as narration. */
export function withAgentActivity<Message extends UIMessage>(
  transport: ChatTransport<Message>,
  turns: AgentTurns,
): ChatTransport<Message> {
  return {
    reconnectToStream: (options) => transport.reconnectToStream(options),
    async sendMessages(options) {
      // No public progress yet: presentation shows its waiting state until the model speaks or the stream starts.
      turns.begin(options.abortSignal);
      try {
        const stream = await transport.sendMessages(options);
        const reader = stream.getReader();
        return new ReadableStream({
          async pull(controller) {
            try {
              const next = await reader.read();
              if (next.done) {
                turns.end();
                controller.close();
                return;
              }
              const chunk = next.value;
              if (chunk.type === 'error') turns.end('failed');
              else if (chunk.type === 'abort') turns.end('cancelled');
              controller.enqueue(chunk);
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
