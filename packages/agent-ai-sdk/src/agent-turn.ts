import type { VacpActor, VacpAgentActivityControl, VacpAgentActivityHandle } from '@vacp/protocol';

/**
 * One public activity per turn, shared by the chat transport, the agent's finish hook and the
 * progress tool. Only the model's own sentences reach the person; until it speaks, presentation shows
 * its waiting line. Lifecycle reporting can never fail a conversation; the tool tells the model
 * whether its words were shown.
 */
export function createAgentTurns(control: Pick<VacpAgentActivityControl, 'beginAgentActivity'>, actor: VacpActor) {
  let turn: VacpAgentActivityHandle | undefined;
  const report = (run: () => void) => {
    try {
      run();
      return true;
    } catch {
      /* Host may have disposed its activity channel. */
      return false;
    }
  };
  return {
    begin(signal?: AbortSignal) {
      report(() => {
        turn?.end();
        turn = control.beginAgentActivity({ actor, signal });
      });
    },
    /** Whether the words reached the host's activity channel. */
    progress(message: string, done = false): boolean {
      return report(() => {
        if (done) {
          (turn ?? control.beginAgentActivity({ actor })).end({ summary: message });
          turn = undefined;
          return;
        }
        if (turn) turn.update(message);
        else turn = control.beginAgentActivity({ actor, summary: message });
      });
    },
    end(outcome?: 'completed' | 'failed' | 'cancelled') {
      report(() => {
        turn?.end({ outcome });
        turn = undefined;
      });
    },
  };
}

export type AgentTurns = ReturnType<typeof createAgentTurns>;
