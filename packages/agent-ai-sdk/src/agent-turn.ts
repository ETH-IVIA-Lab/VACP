import type { VacpActor, VacpAgentActivityControl, VacpAgentActivityHandle } from '@vacp/protocol';

/** Guidance shared by every VACP transport that lets an agent narrate for the person watching. */
export const vacpProgressGuidance =
  'Tell the person what you are doing, in one short plain sentence they can read on screen while you work. ' +
  'Speak to them directly in the present tense about the data and the view, and add the reason when it helps them follow, for example "Narrowing to sprinters under 25 to compare medalists at their peak age". ' +
  'Leave out tool names, references, ids, and remarks about yourself. ' +
  'Call it before each action and again when the picture changes. Set done to true with a brief closing sentence that states what the view now shows.';

const defaultActor: VacpActor = { id: 'agent', kind: 'agent', label: 'Assistant' };

/**
 * One public activity per turn, shared by the chat transport, the agent's finish hook and the
 * progress tool. Lifecycle wording fills the gaps; whatever the model says to the person takes
 * precedence. Lifecycle reporting can never fail a conversation; the tool tells the model whether
 * its words were shown.
 */
export function createAgentTurns(control: VacpAgentActivityControl, actor: VacpActor = defaultActor) {
  let turn: { handle: VacpAgentActivityHandle; narrated: boolean } | undefined;
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
        turn?.handle.end();
        turn = { handle: control.beginAgentActivity({ actor, signal }), narrated: false };
      });
    },
    phase(summary: string) {
      if (turn && !turn.narrated) report(() => turn!.handle.update(summary));
    },
    /** Whether the words reached the host's activity channel. */
    progress(message: string, done = false): boolean {
      return report(() => {
        if (done) {
          if (turn) turn.handle.end({ summary: message });
          else control.beginAgentActivity({ actor }).end({ summary: message });
          turn = undefined;
          return;
        }
        if (turn) {
          turn.handle.update(message);
          turn.narrated = true;
        } else turn = { handle: control.beginAgentActivity({ actor, summary: message }), narrated: true };
      });
    },
    end(outcome?: 'completed' | 'failed' | 'cancelled') {
      report(() => {
        turn?.handle.end({ outcome });
        turn = undefined;
      });
    },
  };
}

export type AgentTurns = ReturnType<typeof createAgentTurns>;
