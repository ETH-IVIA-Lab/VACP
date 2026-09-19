import { expect, test } from '@playwright/test';
import { exampleDir, repoRoot } from '../helpers/paths';
import { startAppServer } from '../helpers/devserver';
import type { WebMCP } from 'webmcp-types';

type Caller = WebMCP.ModelContext & {
  executeTool(tool: WebMCP.RegisteredTool, input: string): Promise<string>;
};

test.use({
  launchOptions: { args: ['--enable-experimental-web-platform-features', '--enable-features=WebMCPTesting'] },
});

test('native WebMCP lets an operation withdraw itself without losing its completed result', async ({ page }) => {
  const server = await startAppServer({ name: 'availability-lifecycle', cwd: exampleDir('react-dashboard') });
  try {
    await page.goto(server.url);
    await page.waitForFunction(() => !!window.__vacp);
    const result = await page.evaluate(async (root) => {
      const { createVacpRuntime, createVacpProvider, VacpActionRegistry } = await import(
        `/@fs${root}/packages/runtime/src/index.ts`
      );
      const { VACP_SCHEMA_VERSION } = await import(`/@fs${root}/packages/protocol/src/index.ts`);
      const { installVacpWebMcp } = await import(`/@fs${root}/packages/transport-webmcp/src/index.ts`);
      const actions = new VacpActionRegistry();
      let available = true;
      actions.register(
        {
          name: 'complete',
          description: 'Complete this step',
          operation: { kind: 'mutation', affects: ['vacp://step'] },
          availability: { requires: ['vacp://step'] },
        },
        () => {
          available = false;
          return 'completed';
        },
      );
      const provider = createVacpProvider({
        source: { id: 'vacp-source://lifecycle', type: 'test', title: 'Lifecycle' },
        actions,
        project: () => ({
          graph: {
            version: VACP_SCHEMA_VERSION,
            nodes: [
              {
                ref: 'vacp://step',
                kind: 'Step',
                layer: 'ViewLayer',
                availability: available ? undefined : { unavailable: 'Step completed' },
              },
            ],
            edges: [],
            actions: actions.list(),
          },
          state: { 'vacp://step': available },
        }),
      });
      const runtime = createVacpRuntime({ providers: [provider] });
      const installation = await installVacpWebMcp(runtime, { namespace: 'lifecycle' });
      try {
        const context = document.modelContext! as Caller;
        const tool = (await context.getTools()).find((candidate) => candidate.name === 'lifecycle.action.complete')!;
        const response = JSON.parse(await context.executeTool(tool, '{}'));
        await installation.refresh();
        return {
          response,
          tools: (await context.getTools())
            .map((candidate) => candidate.name)
            .filter((name) => name.startsWith('lifecycle.'))
            .sort(),
          observation: await runtime.observe(),
          inspection: await runtime.inspect(),
        };
      } finally {
        installation.dispose();
        runtime.dispose();
      }
    }, repoRoot);
    expect(result.response).toMatchObject({ ok: true, result: 'completed' });
    expect(result.tools).toEqual(['lifecycle.capabilities', 'lifecycle.observe', 'lifecycle.state']);
    expect(result.observation.graph.actions).toEqual([]);
    expect(result.inspection.graph.actions.map((action: { name: string }) => action.name)).toEqual(['complete']);
    expect(result.inspection.state['vacp://step']).toBe(false);
  } finally {
    await server.stop();
  }
});
