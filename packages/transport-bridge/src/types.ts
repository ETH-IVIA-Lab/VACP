import type {
  VacpActionExecutionOptions,
  VacpActionResult,
  VacpObservation,
  VacpCapabilitiesRequest,
  VacpCapabilitiesSnapshot,
  VacpStateRequest,
  VacpStateSnapshot,
  VacpStateUpdate,
} from '@vacp/protocol';

export interface VacpTransport {
  vacp_observe(): Promise<VacpObservation>;
  vacp_capabilities(options?: VacpCapabilitiesRequest): Promise<VacpCapabilitiesSnapshot>;
  vacp_state(options?: VacpStateRequest): Promise<VacpStateSnapshot | VacpStateUpdate>;
  /** `narration` is the step's own sentence for the person watching; `actor` attributes the step. */
  vacp_execute(
    name: string,
    params?: unknown,
    call_id?: string,
    options?: Pick<VacpActionExecutionOptions, 'actor' | 'narration'>,
  ): Promise<VacpActionResult>;
}
