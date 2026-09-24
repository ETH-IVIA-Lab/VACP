import { createBrowserPresence } from '@vacp/presence-browser';
import { streamdownText } from '@vacp/presence-browser/streamdown';
import { paceAgentPresence } from '@vacp/presence-core';
import { createProvenanceReplay } from '@vacp/provenance-core';
import { createVacpRestorer, type VacpRuntime } from '@vacp/runtime';
import { exampleOptions } from '../config';

/**
 * Agent steps are paced so a person can follow them: the cursor travels to the target, rests there
 * for a beat, and the result stays on screen for `agentStepPauseMs` before the next call can begin.
 * Human interaction is never delayed; only executions attributed to a presence actor pass through
 * these gates.
 */
const pacing = () => ({
  arrivalTimeoutMs: 900,
  beforeExecuteMs: 320,
  afterExecuteMs: exampleOptions.agentStepPauseMs,
});

/** The galleries share a presentation policy; recording and restoration remain independent services. */
export function createExamplePresence(runtime: VacpRuntime, root: Element) {
  const restorer = createVacpRestorer(runtime);
  const replay = createProvenanceReplay(runtime, {
    restore: (observation, options) => restorer.restore(observation.state, options),
  });
  const inputIntent = (event: Event) => {
    if (event.isTrusted && replay.getState().phase === 'restoring') replay.interrupt();
  };
  const inputEvents = ['pointerdown', 'keydown', 'input'] as const;
  for (const event of inputEvents) root.addEventListener(event, inputIntent, true);
  const release = () => {
    for (const event of inputEvents) root.removeEventListener(event, inputIntent, true);
    runtime.signal.removeEventListener('abort', release);
    replay.dispose();
  };
  runtime.signal.addEventListener('abort', release, { once: true });
  try {
    const presence = createBrowserPresence(runtime, {
      appearance: { text: streamdownText, bubble: { width: 290 }, durationMs: 460 },
      replay,
    });
    const stopPacing = exampleOptions.paceAgentSteps ? paceAgentPresence(runtime, presence, pacing()) : () => {};
    return {
      ...presence,
      dispose() {
        stopPacing();
        presence.dispose();
        release();
      },
    };
  } catch (error) {
    release();
    throw error;
  }
}
