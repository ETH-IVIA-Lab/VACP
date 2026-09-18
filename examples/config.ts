/** Example exposure profiles used by the gallery and evaluation harness. */
export type ExampleOptions = {
  exposeBridge: boolean;
  injectDomSnapshot: boolean;
  enableSql: boolean;
  webmcp: boolean;
  runtimeId?: string;
};

declare global {
  var __vacpExampleOptions: Partial<ExampleOptions> | undefined;
}

const profiles: Record<string, Omit<ExampleOptions, 'webmcp'>> = {
  visual: { exposeBridge: false, injectDomSnapshot: false, enableSql: true },
  snapshot: { exposeBridge: false, injectDomSnapshot: true, enableSql: true },
  semantic: { exposeBridge: true, injectDomSnapshot: false, enableSql: true },
  guided: { exposeBridge: true, injectDomSnapshot: true, enableSql: false },
  full: { exposeBridge: true, injectDomSnapshot: true, enableSql: true },
};

const context = new URLSearchParams(window.location.search).get('context') ?? 'full';
const profile = profiles[context];
if (!profile) throw new Error(`Unknown example context: ${context}`);

export const exampleOptions: Readonly<ExampleOptions> = {
  ...profile,
  webmcp: profile.exposeBridge,
  ...globalThis.__vacpExampleOptions,
};
