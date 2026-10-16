/** Application-owned exposure and data-access options for the examples. */
export type ExampleOptions = {
  exposeBridge: boolean;
  injectDomSnapshot: boolean;
  enableSql: boolean;
  webmcp: boolean;
  /** Pace agent steps so a person can follow them. Automation that drives many steps can turn this off. */
  paceAgentSteps: boolean;
  /** Pause after each agent step before the next one can begin, in milliseconds. */
  agentStepPauseMs: number;
};

declare global {
  var __vacpExampleOptions: Partial<ExampleOptions> | undefined;
}

export const exampleOptions: Readonly<ExampleOptions> = {
  exposeBridge: true,
  injectDomSnapshot: true,
  enableSql: true,
  webmcp: true,
  paceAgentSteps: true,
  agentStepPauseMs: 1200,
  ...globalThis.__vacpExampleOptions,
};
