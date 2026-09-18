export type VacpInspectorEnabled = boolean | 'auto';

export interface VacpInspectorOptions {
  /**
   * If `true`, always show the overlay.
   * If `false`, never show it.
   * If `'auto'`, use the VACP inspector flag. The flag defaults to on and can be disabled with:
   * - URL: `?vacp-inspector=0`
   * - env: `VACP_INSPECTOR=0`
   * - localStorage: `vacp:inspector=0`
   */
  enabled?: VacpInspectorEnabled;
  /** Which global bridge key to read (defaults to `__vacp`). */
  globalKey?: string;
  /** Whether to show semantic actions as graph nodes by default. */
  includeActions?: boolean;
}
