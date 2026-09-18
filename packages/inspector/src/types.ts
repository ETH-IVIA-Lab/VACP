export interface VacpInspectorOptions {
  /** Which global bridge key to read (defaults to `__vacp`). */
  globalKey?: string;
  /** Whether to show semantic actions as graph nodes by default. */
  includeActions?: boolean;
}
