import type {
  VacpActionExecutionOptions,
  VacpCapabilitiesRequest,
  VacpStateRequest,
  VacpToolResult,
} from '@vacp/protocol';

/**
 * The agent tools of `vacpAgentTools` other than `vacp_progress`, over a bridge. Each method takes the
 * tool's input as the model sent it and answers with the JSON the model reads. A bare `vacp://` scope
 * reads everything, and an unscoped capabilities read leaves out node data unless asked. Graph reads
 * leave out source ownership, which models do not route by, and every answer is cut to the limits of
 * `vacpToolResult`.
 */
export interface VacpTransport {
  vacp_observe(): Promise<VacpToolResult>;
  vacp_capabilities(input?: VacpCapabilitiesRequest): Promise<VacpToolResult>;
  vacp_state(input?: VacpStateRequest): Promise<VacpToolResult>;
  /** `narration` is the step's own sentence for the person watching; `actor` attributes the step. */
  vacp_execute(
    name: string,
    params?: unknown,
    call_id?: string,
    options?: Pick<VacpActionExecutionOptions, 'actor' | 'narration'>,
  ): Promise<VacpToolResult>;
}
