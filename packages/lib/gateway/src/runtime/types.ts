import type { VacpCapabilitiesSnapshot, VacpStateSnapshot } from '@vacp/core';

export interface VacpSnapshotProvider {
  getCapabilities(): VacpCapabilitiesSnapshot | Promise<VacpCapabilitiesSnapshot>;
  getState(): VacpStateSnapshot | Promise<VacpStateSnapshot>;
}
