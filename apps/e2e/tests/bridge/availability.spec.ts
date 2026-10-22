import { expect } from '@playwright/test';
import { test, useWebMcp } from '../helpers/test';
import { repoRoot } from '../helpers/paths';
import { gotoApp } from '../helpers/servers';

useWebMcp();

test('dashboard discovery follows dataset, selection, restoration, and native view changes', async ({ page }) => {
  const scatterRef = 'vacp://vacp-examples/react/dashboard/recharts/viz/scatter/mark/scatter';
  const chartRef = 'vacp://vacp-examples/react/dashboard/recharts/viz/scatter';
  // Applying a saved state is acquisition too: replay restores views recorded before any dataset loaded.
  const acquisitionActions = ['dashboard.set_dataset', 'vacp.apply_state'];
  const acquisitionTools = [
    'vacp.action.dashboard.set_dataset',
    'vacp.action.vacp.apply_state',
    'vacp.capabilities',
    'vacp.observe',
    'vacp.progress',
    'vacp.state',
  ];
  await gotoApp(page, 'react-dashboard');
  const names = () =>
    page.evaluate(async () =>
      (await window.__vacp!.getCapabilities()).graph.actions.map((action) => action.name).sort(),
    );
  const tools = () =>
    page.evaluate(async () => (await document.modelContext!.getTools()).map((tool) => tool.name).sort());
  const catalog = await test.step('only acquisition is disclosed before a dataset exists', async () => {
    await expect.poll(names).toEqual(acquisitionActions);
    await expect.poll(tools).toEqual(acquisitionTools);
    const initial = await page.evaluate(async () => {
      const full = await window.__vacp!.inspect();
      const blocked = await window.__vacp!.execute({
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
    expect(initial.visible.sort()).toEqual(acquisitionActions);
    expect(initial.dom.graph.actions.map((action: { name: string }) => action.name).sort()).toEqual(acquisitionActions);
    expect(initial.blocked.ok).toBe(false);
    await expect(page.locator('svg circle[data-point-id]')).toHaveCount(0);
    return initial.catalog;
  });

  await test.step('native WebMCP acquisition reveals the chart and its prerequisites', async () => {
    const loaded = await page.evaluate(async () => {
      const context = document.modelContext!;
      const tool = (await context.getTools()).find((tool) => tool.name === 'vacp.action.dashboard.set_dataset')!;
      return JSON.parse(await context.executeTool(tool, { id: 'iris', narration: 'Loading the iris measurements.' }));
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
        const result = await bridge.execute(call);
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
        name: 'dashboard.set_selected_ids',
        params: { ids: [id] },
      });
      if (!selected.ok) throw new Error(selected.error.message);
      const saved = (await bridge.inspect()).state;
      const cleared = await bridge.execute({
        name: 'dashboard.set_selected_ids',
        params: { ids: [] },
      });
      if (!cleared.ok) throw new Error(cleared.error.message);
      const { createVacpRestorer } = await import(`/@fs${root}/packages/runtime/src/index.ts`);
      const result = await createVacpRestorer(bridge).restore(saved);
      const state = (await bridge.inspect()).state;
      const scatter = Object.keys(state).find((ref) => ref.endsWith('/mark/scatter'))!;
      const rejected = await bridge.execute({
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
      const { createInspectionIndex, createInspectorSession, createRuntimeInspectorClient } = await import(
        `/@fs${root}/apps/e2e/fixtures/inspection.ts`
      );
      // The page publishes the runtime itself, whose snapshot subscription drives the session.
      const session = createInspectorSession(
        createRuntimeInspectorClient({ id: 'dashboard', title: 'Dashboard', runtime: window.__vacp }),
      );
      const ready = new Promise<void>((resolve) => {
        const stop = session.subscribe(() => {
          if (session.getState().status !== 'ready') return;
          stop();
          resolve();
        });
      });
      session.start();
      await ready;
      const { observation } = session.getState();
      session.dispose();
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
    await expect.poll(names).toEqual(acquisitionActions);
    await expect.poll(tools).toEqual(acquisitionTools);
    const stale = await page.evaluate(() =>
      window.__vacp!.execute({
        name: 'dashboard.set_brush_2d',
        params: { x0: 0, x1: 10, y0: 0, y1: 10 },
      }),
    );
    expect(stale.ok).toBe(false);
    await expect(page.getByRole('button', { name: 'Clear selection', exact: true })).toBeDisabled();
  });
});

test('native WebMCP lets an operation withdraw itself without losing its completed result', async ({ page }) => {
  await gotoApp(page, 'react-dashboard');
  const result = await page.evaluate(async (root) => {
    const { createVacpRuntime, createVacpProvider, VacpActionRegistry } = await import(
      `/@fs${root}/packages/runtime/src/index.ts`
    );
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
      subscribe: () => () => {},
      project: () => ({
        graph: {
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
      const context = document.modelContext!;
      const tool = (await context.getTools()).find((candidate) => candidate.name === 'lifecycle.action.complete')!;
      const response = JSON.parse(await context.executeTool(tool, { narration: 'Completing the task.' }));
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
  expect(result.tools).toEqual([
    'lifecycle.capabilities',
    'lifecycle.observe',
    'lifecycle.progress',
    'lifecycle.state',
  ]);
  expect(result.observation.graph.actions).toEqual([]);
  expect(result.inspection.graph.actions.map((action: { name: string }) => action.name)).toEqual(['complete']);
  expect(result.inspection.state['vacp://step']).toBe(false);
});
