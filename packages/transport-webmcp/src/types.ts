import type { WebMCP } from 'webmcp-types';
import type {
  VacpActionDescriptor,
  VacpAgentActivityControl,
  VacpCapabilitiesSnapshot,
  VacpGraph,
  VacpWindowBridge,
  VacpActor,
} from '@vacp/protocol';

/** The executable protocol surface needed by the compiler; no browser globals. */
export type VacpWebMcpClient = Pick<VacpWindowBridge, 'observe' | 'getCapabilities' | 'getState' | 'execute'>;

/**
 * Live capability and lifetime ports used by automatic registration. A source that publishes agent
 * activity also receives a progress tool so the agent can narrate for the person watching.
 */
export type VacpWebMcpSource = VacpWebMcpClient &
  Partial<VacpAgentActivityControl> & {
    readonly signal: AbortSignal;
    subscribeCapabilities(listener: (snapshot: VacpCapabilitiesSnapshot) => void): () => void;
  };

/** Only registration is required. The adapter never clears another owner's tools. */
export type VacpWebMcpRegistry = {
  registerTool(tool: WebMCP.ModelContextTool, options?: WebMCP.ModelContextRegisterToolOptions): Promise<void>;
};

export type VacpWebMcpOptions = {
  /** Host attribution shared by WebMCP action executions. */
  actor?: VacpActor;
  /** Namespace shared by the context tools and action tools. Defaults to "vacp". */
  namespace?: string;
  /** Choose which graph actions become callable tools. The graph itself remains available. */
  includeAction?: (action: VacpActionDescriptor, graph: VacpGraph) => boolean;
  /** Override the full tool name for application action names that are not valid WebMCP names. */
  actionName?: (action: VacpActionDescriptor) => string;
  /** Override automatic wrapping. Only explicit object schemas pass through by default. */
  inputMode?: (action: VacpActionDescriptor) => 'object' | 'params';
  annotations?: (action: VacpActionDescriptor) => WebMCP.ToolAnnotations;
};
