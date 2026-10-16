import type { WebMCP } from 'webmcp-types';
import type { VacpAgentActivityControl, VacpCapabilitiesSnapshot, VacpWindowBridge, VacpActor } from '@vacp/protocol';

/** The executable protocol surface needed by the compiler; no browser globals. */
export type VacpWebMcpClient = Pick<VacpWindowBridge, 'observe' | 'getCapabilities' | 'getState' | 'execute'>;

/** Live capability, narration, and lifetime ports used by automatic registration. */
export type VacpWebMcpSource = VacpWebMcpClient &
  Pick<VacpAgentActivityControl, 'narrate'> & {
    readonly signal: AbortSignal;
    subscribeCapabilities(listener: (snapshot: VacpCapabilitiesSnapshot) => void): () => void;
  };

/** Only registration is required. The adapter never clears another owner's tools. */
export type VacpWebMcpRegistry = {
  registerTool(tool: WebMCP.ModelContextTool, options?: WebMCP.ModelContextRegisterToolOptions): Promise<void>;
};

export type VacpWebMcpOptions = {
  /** Attribution of every step and sentence. Defaults to `vacpAgentActor`. */
  actor?: VacpActor;
  /** Namespace shared by the context tools and action tools. Defaults to "vacp". */
  namespace?: string;
  /** Reports a failed automatic registration after a capability change. */
  onError?: (cause: unknown) => void;
  /** Removes the tools when aborted. */
  signal?: AbortSignal;
  /** The registry to install into. Defaults to `document.modelContext`. */
  context?: VacpWebMcpRegistry;
};
