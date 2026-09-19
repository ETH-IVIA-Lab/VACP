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

test('dashboard discovery follows dataset, selection, restoration, and native view changes', async ({ page }) => {
  const server = await startAppServer({ name: 'availability', cwd: exampleDir('react-dashboard') });
  const scatterRef = 'vacp://vacp-examples/react/dashboard/recharts/viz/scatter/mark/scatter';
  const chartRef = 'vacp://vacp-examples/react/dashboard/recharts/viz/scatter';
  const acquisitionTools = ['vacp.action.dashboard.set_dataset', 'vacp.capabilities', 'vacp.observe', 'vacp.state'];
  try {
    await page.goto(server.url);
    await page.waitForFunction(() => !!window.__vacp);
    const names = () =>
      page.evaluate(async () =>
        (await window.__vacp!.getCapabilities()).graph.actions.map((action) => action.name).sort(),
      );
    const tools = () =>
      page.evaluate(async () => (await document.modelContext!.getTools()).map((tool) => tool.name).sort());
    const catalog = await test.step('only acquisition is disclosed before a dataset exists', async () => {
      await expect.poll(names).toEqual(['dashboard.set_dataset']);
      await expect.poll(tools).toEqual(acquisitionTools);
      const initial = await page.evaluate(async () => {
        const full = await window.__vacp!.inspect();
        const blocked = await window.__vacp!.execute({
          callId: 'too-early',
          name: 'dashboard.set_encoding',
          params: { x: 'hp', y: 'mpg' },
        });
        const visible = await window.__vacp!.observe();
        const dom = JSON.parse(document.querySelector('script[data-vacp="snapshot-graph"]')!.textContent!);
        return {
          catalog: full.graph.actions.map((action) => action.name).sort(),
          visible: visible.graph.actions.map((action) => action.name),
          blocked,
          dom,
        };
      });
      expect(initial.catalog).toEqual(expect.arrayContaining(['dashboard.set_encoding', 'dashboard.set_brush_2d']));
      expect(initial.visible).toEqual(['dashboard.set_dataset']);
      expect(initial.dom.graph.actions.map((action: { name: string }) => action.name)).toEqual([
        'dashboard.set_dataset',
      ]);
      expect(initial.blocked.ok).toBe(false);
      await expect(page.locator('svg circle[data-point-id]')).toHaveCount(0);
      return initial.catalog;
    });

    await test.step('native WebMCP acquisition reveals the chart and its prerequisites', async () => {
      const loaded = await page.evaluate(async () => {
        const context = document.modelContext! as Caller;
        const tool = (await context.getTools()).find((tool) => tool.name === 'vacp.action.dashboard.set_dataset')!;
        return JSON.parse(await context.executeTool(tool, JSON.stringify({ id: 'iris' })));
      });
      expect(loaded.ok).toBe(true);
      await expect(page.locator('svg circle[data-point-id]')).toHaveCount(150);
      await expect.poll(names).toContain('dashboard.set_brush_2d');
      await expect.poll(tools).toContain('vacp.action.dashboard.set_brush_2d');
      const dependencies = await page.evaluate(() => {
        const graph = JSON.parse(document.querySelector('script[data-vacp="snapshot-graph"]')!.textContent!).graph;
        const action = graph.actions.find((candidate: { name: string }) => candidate.name === 'dashboard.set_brush_2d');
        const target = graph.nodes.find((node: { ref: string }) => node.ref === action.availability.requires[0]);
        return { action: action.availability.requires, target: target.availability.requires };
      });
      expect(dependencies).toEqual({ action: [scatterRef], target: [chartRef] });
    });

    for (const call of [
      { name: 'dashboard.set_brush_2d', params: { x0: null, x1: 10, y0: 0, y1: 10 } },
      { name: 'dashboard.set_selected_ids', params: { ids: 'not-an-array' } },
      { name: 'dashboard.select_by_quantiles', params: { xMaxQ: 2 } },
      { name: 'dashboard.set_encoding', params: { x: 'Species', y: 'missing-column' } },
      { name: 'dashboard.toggle_selected_id', params: { id: 'missing-row' } },
    ])
      await test.step(`${call.name} rejects invalid input without changing state`, async () => {
        const invalid = await page.evaluate(async (call) => {
          const bridge = window.__vacp!;
          const before = (await bridge.inspect()).state;
          const result = await bridge.execute({ callId: crypto.randomUUID(), ...call });
          return { before, after: (await bridge.inspect()).state, result };
        }, call);
        expect(invalid.result.ok).toBe(false);
        expect(invalid.after).toEqual(invalid.before);
      });

    await test.step('restoration retains explicit points and an absent brush', async () => {
      const restored = await page.evaluate(async (root) => {
        const bridge = window.__vacp!;
        const id = document.querySelector('circle[data-point-id]')!.getAttribute('data-point-id')!;
        const selected = await bridge.execute({
          callId: 'select-one',
          name: 'dashboard.set_selected_ids',
          params: { ids: [id] },
        });
        if (!selected.ok) throw new Error(selected.error.message);
        const saved = (await bridge.inspect()).state;
        const cleared = await bridge.execute({
          callId: 'clear-before-restore',
          name: 'dashboard.set_selected_ids',
          params: { ids: [] },
        });
        if (!cleared.ok) throw new Error(cleared.error.message);
        const { createVacpRestorer } = await import(`/@fs${root}/packages/runtime/src/index.ts`);
        const result = await createVacpRestorer(bridge).restore(saved);
        const state = (await bridge.inspect()).state;
        const scatter = Object.keys(state).find((ref) => ref.endsWith('/mark/scatter'))!;
        const rejected = await bridge.execute({
          callId: 'invalid-restoration',
          name: 'vacp.apply_state',
          params: { state: { [scatter]: { x: 'Species', y: 'missing' } } },
        });
        return { result, rejected, state, after: (await bridge.inspect()).state };
      }, repoRoot);
      expect(restored.result.ok).toBe(true);
      expect(restored.rejected.ok).toBe(false);
      expect(restored.after).toEqual(restored.state);
      const brush = Object.entries(restored.state).find(([ref]) => ref.endsWith('/selection/brush2d'))![1];
      expect(brush).toMatchObject({ x0: null, x1: null, y0: null, y1: null });
      await expect(page.locator('circle[data-point-id][data-selected="true"]')).toHaveCount(1);
    });

    await test.step('clearing an axis withdraws brushing but preserves full inspection', async () => {
      await page.getByRole('button', { name: 'Clear x encoding', exact: true }).click();
      await expect(page.locator('svg circle[data-point-id]')).toHaveCount(0);
      await expect.poll(names).not.toContain('dashboard.set_brush_2d');
      await expect.poll(names).toContain('dashboard.set_encoding');
      await expect.poll(tools).not.toContain('vacp.action.dashboard.set_brush_2d');
      const inspection = await page.evaluate(async (root) => {
        const { createInspectionIndex } = await import(`/@fs${root}/packages/inspector-core/src/index.ts`);
        const { createRuntimeInspectorClient } = await import(`/@fs${root}/packages/inspector-core/src/runtime.ts`);
        const client = createRuntimeInspectorClient({ id: 'dashboard', title: 'Dashboard', runtime: window.__vacp });
        const observation = await client.observe({ signal: new AbortController().signal });
        const action = createInspectionIndex(observation).action('dashboard.set_brush_2d');
        return {
          catalog: observation.graph.actions.map((action: { name: string }) => action.name).sort(),
          status: action.availability,
          prerequisites: action.prerequisites.map((node: { ref: string }) => node.ref),
        };
      }, repoRoot);
      expect(inspection.catalog).toEqual(catalog);
      expect(inspection.status).toMatchObject({ available: false, blockedBy: [scatterRef] });
      expect(inspection.prerequisites).toEqual([scatterRef]);
    });

    await test.step('clearing the dataset returns to acquisition and rejects a stale brush call', async () => {
      await page.getByRole('button', { name: 'Clear dataset', exact: true }).click();
      await expect.poll(names).toEqual(['dashboard.set_dataset']);
      await expect.poll(tools).toEqual(acquisitionTools);
      const stale = await page.evaluate(() =>
        window.__vacp!.execute({
          callId: 'stale',
          name: 'dashboard.set_brush_2d',
          params: { x0: 0, x1: 10, y0: 0, y1: 10 },
        }),
      );
      expect(stale.ok).toBe(false);
      await expect(page.getByRole('button', { name: 'Clear selection', exact: true })).toBeDisabled();
    });
  } finally {
    await server.stop();
  }
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
