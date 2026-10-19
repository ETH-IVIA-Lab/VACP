import { createBrowserPresence } from '@ethivia/vacp-presence-browser';
import { streamdownText } from '@ethivia/vacp-presence-browser/streamdown';
import { paceAgentPresence, type PresencePresentation } from '@ethivia/vacp-presence-core';
import type { VacpProvider } from '@ethivia/vacp-protocol';
import { createProvenanceReplay } from '@ethivia/vacp-provenance-core';
import { createVacpRestorer, type VacpRuntime } from '@ethivia/vacp-runtime';
import { installVacpRuntime } from '@ethivia/vacp-runtime-browser';
import { installVacpWebMcp } from '@ethivia/vacp-transport-webmcp';
import { installExampleAnalytics } from './analytics';
import { exampleOptions } from './config';

/** A provider and the presentation that places presence on its rendered marks and controls. */
export type ExampleSource = { provider: VacpProvider; presentation: PresencePresentation };

const inputEvents = ['pointerdown', 'keydown', 'input'] as const;

/**
 * Install VACP for one mounted example: the runtime and its bridge, presence with replay, WebMCP
 * tools, and analytics. Everything installed here is released when `signal` aborts, and a failed
 * installation releases what it had installed before it rejects.
 *
 * Agent steps are paced so a person can follow them: the cursor travels to the target, rests there
 * for a beat, and the result stays on screen for `agentStepPauseMs` before the next call can begin.
 * Human interaction is never delayed. A person's input during a replay interrupts it.
 */
export async function installExampleRuntime(args: {
  sources: readonly ExampleSource[];
  root: Element;
  sessionKey: string;
  analytics: Record<string, string>;
  signal: AbortSignal;
}): Promise<VacpRuntime> {
  const { root, signal } = args;
  signal.throwIfAborted();
  const cleanup: Array<() => void> = [];
  const release = () => {
    for (const dispose of cleanup.splice(0).reverse()) dispose();
  };
  signal.addEventListener('abort', release, { once: true });
  try {
    const installation = installVacpRuntime({
      providers: args.sources.map(({ provider }) => provider),
      sessionKey: args.sessionKey,
      exposeBridge: exampleOptions.exposeBridge,
      injectDomSnapshot: exampleOptions.injectDomSnapshot,
    });
    cleanup.push(installation.dispose);
    const { runtime } = installation;

    const replay = createProvenanceReplay(runtime, { restore: createVacpRestorer(runtime).restore });
    cleanup.push(() => replay.dispose());
    const interrupt = (event: Event) => {
      if (event.isTrusted && replay.getState().phase === 'restoring') replay.interrupt();
    };
    for (const type of inputEvents) root.addEventListener(type, interrupt, true);
    cleanup.push(() => {
      for (const type of inputEvents) root.removeEventListener(type, interrupt, true);
    });

    const presence = createBrowserPresence(runtime, {
      appearance: { text: streamdownText, bubble: { width: 290 }, durationMs: 460 },
      replay,
    });
    cleanup.push(() => presence.dispose());
    if (exampleOptions.paceAgentSteps)
      cleanup.push(
        paceAgentPresence(runtime, presence, {
          arrivalTimeoutMs: 900,
          beforeExecuteMs: 320,
          afterExecuteMs: exampleOptions.agentStepPauseMs,
        }),
      );
    for (const { provider, presentation } of args.sources) presence.attach(provider, presentation);

    cleanup.push(installExampleAnalytics(runtime, args.analytics));

    if (exampleOptions.webmcp) {
      const webmcp = await installVacpWebMcp(runtime, {
        signal,
        onError: (cause) => console.error('WebMCP registration failed', cause),
      });
      if (webmcp) cleanup.push(() => webmcp.dispose());
    }
    signal.throwIfAborted();
    return runtime;
  } catch (error) {
    signal.removeEventListener('abort', release);
    release();
    throw error;
  }
}
