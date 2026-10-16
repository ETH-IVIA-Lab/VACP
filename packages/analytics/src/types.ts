import type { VacpProvenanceSource } from '@vacp/protocol';

export type VacpAnalyticsProvider = Readonly<{
  capture: (event: string, properties?: Record<string, unknown>) => void;
  setSessionProperties?: (properties: Record<string, unknown>) => void;
  startSessionRecording?: () => void;
}>;

export type VacpRuntimeAnalyticsOptions = Readonly<{
  /** Include analytical state in telemetry. Defaults to false. */
  captureSnapshots?: boolean;
  getBaseProperties?: () => Record<string, unknown>;
}>;

export type VacpRuntimeAnalyticsInstallation = Readonly<{ dispose(): void }>;

export type InstallVacpRuntimeAnalyticsArgs = VacpRuntimeAnalyticsOptions &
  Readonly<{
    bridge: VacpProvenanceSource & { readonly version: string; readonly signal: AbortSignal };
    provider: VacpAnalyticsProvider;
  }>;
