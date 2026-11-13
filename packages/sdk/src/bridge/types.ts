import type {
  VacpAgentActivityControl,
  VacpCapabilitiesRequest,
  VacpStateRequest,
  VacpToolResult,
  VacpWindowBridge,
} from '../protocol';

/** The bridge the tool handlers read, execute, and narrate through. */
export type VacpToolBridge = VacpWindowBridge & Pick<VacpAgentActivityControl, 'narrate'>;

export type VacpExecuteInput = {
  name: string;
  params?: unknown;
  /** The step's own sentence for the person watching. */
  narration: string;
  /**
   * The host's ID for the call, such as the model API's tool call ID. The model never fills it. The
   * runtime assigns one when it is absent, null, or blank.
   */
  callId?: string | null;
};

export type VacpProgressInput = { message: string; done?: boolean };

/**
 * The tools of `vacpAgentTools` over a bridge, keyed by tool name. Each takes the tool's input as the
 * model sent it and answers with the JSON the model reads, cut to the limits of `vacpToolResult`.
 * Graph reads leave out source ownership. A `signal` cancels the step or the turn the call opens.
 */
export interface VacpToolHandlers {
  vacp_observe(input?: Record<string, never>): Promise<VacpToolResult>;
  vacp_capabilities(input?: VacpCapabilitiesRequest): Promise<VacpToolResult>;
  vacp_state(input?: VacpStateRequest): Promise<VacpToolResult>;
  vacp_execute(input: VacpExecuteInput, signal?: AbortSignal): Promise<VacpToolResult>;
  vacp_progress(input: VacpProgressInput, signal?: AbortSignal): Promise<VacpToolResult>;
}
