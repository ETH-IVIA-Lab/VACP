import type { Page } from '@playwright/test';

export async function operationNames(page: Page, contracts: readonly string[]): Promise<Record<string, string>> {
  return page.evaluate(async (contracts) => {
    const { graph } = await globalThis.__vacp.getCapabilities();
    return Object.fromEntries(
      contracts.map((contract) => {
        const matches = graph.actions.filter((action) => action.operation?.contract === contract);
        if (matches.length !== 1) {
          throw new Error(`Expected one operation for ${contract}, found ${matches.length}`);
        }
        return [contract, matches[0]!.name];
      }),
    );
  }, contracts);
}

export async function executeOperation(page: Page, contract: string, params: Record<string, unknown>) {
  const names = await operationNames(page, [contract]);
  return page.evaluate(({ name, params }) => globalThis.__vacp.execute({ callId: crypto.randomUUID(), name, params }), {
    name: names[contract]!,
    params,
  });
}
