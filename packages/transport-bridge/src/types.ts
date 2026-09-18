import type {
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
  vacp_execute(name: string, params?: unknown, call_id?: string): Promise<VacpActionResult>;
}
