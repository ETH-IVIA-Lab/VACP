import type { ChatTransport, UIMessage } from 'ai';
import type { VacpActor, VacpAgentActivityControl } from '@vacp/protocol';

type Outcome = 'completed' | 'failed' | 'cancelled';

/**
 * One turn per chat request: it opens when the request is sent, so presentation shows its waiting
 * state until the model speaks, and the request's outcome closes it. The model's sentences and steps
 * join this turn through the runtime's narrator, and a closing sentence ends it first. Reporting can
 * never fail a conversation, so a disposed activity channel leaves chat running.
 */
export function withAgentActivity<Message extends UIMessage>(
  transport: ChatTransport<Message>,
  control: Pick<VacpAgentActivityControl, 'beginAgentActivity'>,
  actor: VacpActor,
): ChatTransport<Message> {
  const begin = createActivityRequests(control, actor);
  return {
    reconnectToStream: (options) => transport.reconnectToStream(options),
    async sendMessages(options) {
      const end = begin(options.abortSignal);
      try {
        const reader = (await transport.sendMessages(options)).getReader();
        return new ReadableStream({
          async pull(controller) {
            try {
              const next = await reader.read();
              if (next.done) {
                end('completed');
                controller.close();
                return;
              }
              if (next.value.type === 'error') end('failed');
              else if (next.value.type === 'abort') end('cancelled');
              controller.enqueue(next.value);
            } catch (error) {
              end('failed');
              controller.error(error);
            }
          },
          cancel(reason) {
            end('cancelled');
            return reader.cancel(reason);
          },
        });
      } catch (error) {
        end('failed');
        throw error;
      }
    },
  };
}

export function createActivityRequests(
  control: Pick<VacpAgentActivityControl, 'beginAgentActivity'>,
  actor: VacpActor,
) {
  let endPrevious: ((outcome: Outcome) => void) | undefined;
  const begin = (signal: AbortSignal | undefined) => {
    endPrevious?.('completed');
    let turn: ReturnType<typeof control.beginAgentActivity> | undefined;
    try {
      turn = control.beginAgentActivity({ actor, signal });
    } catch {
      /* The host may have disposed its activity channel. */
    }
    const end = (outcome: Outcome) => {
      const ending = turn;
      turn = undefined;
      try {
        ending?.end({ outcome });
      } catch {
        /* The host may have disposed its activity channel. */
      }
    };
    endPrevious = end;
    return end;
  };
  return begin;
}
