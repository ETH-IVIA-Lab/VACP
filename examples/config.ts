/** Application-owned exposure and data-access options for the examples. */
export type ExampleOptions = {
  exposeBridge: boolean;
  injectDomSnapshot: boolean;
  enableSql: boolean;
  webmcp: boolean;
};

declare global {
  var __vacpExampleOptions: Partial<ExampleOptions> | undefined;
}

export const exampleOptions: Readonly<ExampleOptions> = {
  exposeBridge: true,
  injectDomSnapshot: true,
  enableSql: true,
  webmcp: true,
  ...globalThis.__vacpExampleOptions,
};
