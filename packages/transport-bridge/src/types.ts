import type {
  VacpActionExecutionOptions,
  VacpActionResult,
  VacpObservation,
  VacpCapabilitiesRequest,
  VacpCapabilitiesSnapshot,
  VacpStateRequest,
  VacpStateSnapshot,
  VacpStateUpdate,
  VacpToolRead,
} from '@vacp/protocol';

/**
 * The agent tools of `vacpAgentTools` other than `vacp_progress`, over a bridge. Each method takes the
 * tool's input as the model sent it. A bare `vacp://` scope reads everything, and an unscoped
 * capabilities read leaves out node data unless asked. Graph reads leave out source ownership, which
 * models do not route by.
 */
export interface VacpTransport {
  vacp_observe(): Promise<VacpToolRead<VacpObservation>>;
  vacp_capabilities(input?: VacpCapabilitiesRequest): Promise<VacpToolRead<VacpCapabilitiesSnapshot>>;
  vacp_state(input?: VacpStateRequest): Promise<VacpStateSnapshot | VacpStateUpdate>;
  /** `narration` is the step's own sentence for the person watching; `actor` attributes the step. */
  vacp_execute(
    name: string,
    params?: unknown,
    call_id?: string,
    options?: Pick<VacpActionExecutionOptions, 'actor' | 'narration'>,
  ): Promise<VacpActionResult>;
}
