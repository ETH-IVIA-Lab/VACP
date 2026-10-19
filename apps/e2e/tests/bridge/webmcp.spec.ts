import type * as VacpRuntime from '@ethivia/vacp-runtime';
import type * as VacpRuntimeBrowser from '@ethivia/vacp-runtime-browser';
import type * as VacpSdk from '@ethivia/vacp-sdk';
import type * as VacpWebMcp from '@ethivia/vacp-transport-webmcp';
import { expect } from '@playwright/test';
import { test, useWebMcp } from '../helpers/test';
import { repoRoot } from '../helpers/paths';
import { appServer, gotoApp } from '../helpers/servers';
import type {} from 'webmcp-types';

useWebMcp();

test('native WebMCP projects composed providers and unregisters them on disposal', async ({ page }) => {
  const server = appServer('cars-parallel-coords');
  await page.addInitScript(() => {
    globalThis.__vacpExampleOptions = { ...globalThis.__vacpExampleOptions, exposeBridge: false, webmcp: true };
  });
  await page.goto(server.url);
  await expect
    .poll(() => page.evaluate(async () => (await document.modelContext?.getTools())?.length ?? 0))
    .toBeGreaterThan(2);
  expect(await page.evaluate(() => window.__vacp)).toBeUndefined();
  const graph = await page.evaluate(async () => {
    const context = document.modelContext;
    if (!context) throw new Error('Current WebMCP API unavailable');
    const tools = await context.getTools();
    const capabilities = tools.find((tool) => tool.name === 'vacp.capabilities');
    if (!capabilities) throw new Error('Missing graph tool');
    return {
      ...JSON.parse(await context.executeTool(capabilities, {})),
      tools: tools.map((tool) => tool.name),
    };
  });
  expect(graph.graph.nodes.length).toBeGreaterThan(0);
  expect(graph.graph.edges.length).toBeGreaterThan(0);
  // Each available action is its own tool beside the graph reads.
  expect(graph.tools).toContain('vacp.action.parallel_coords.set_dimension_order');

  await page.evaluate(
    async ({ root }) => {
      const context = document.modelContext;
      if (!context) throw new Error('WebMCP unavailable');
      await context.registerTool({
        name: 'unrelated',
        description: 'An independently registered tool',
        execute: () => 'ok',
      });
      const { connectThreshold } = await import(`/@fs${root}/examples/custom-integration/threshold.ts`);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.value = '10';
      input.id = 'custom-threshold';
      document.body.append(input);
      connectThreshold(input);
    },
    { root: repoRoot },
  );
  await expect
    .poll(() => page.evaluate(async () => (await document.modelContext?.getTools())?.map((tool) => tool.name).sort()))
    .toEqual(
      expect.arrayContaining([
        'unrelated',
        'vacp.action.parallel_coords.set_dimension_order',
        'vacp.action.threshold.set',
        'vacp.capabilities',
        'vacp.observe',
        'vacp.state',
      ]),
    );
  const results = await page.evaluate(async () => {
    const context = document.modelContext!;
    const tools = await context.getTools();
    const action = tools.find((tool) => tool.name === 'vacp.action.threshold.set')!;
    const observe = tools.find((tool) => tool.name === 'vacp.observe')!;
    const state = tools.find((tool) => tool.name === 'vacp.state')!;
    const progress = tools.find((tool) => tool.name === 'vacp.progress')!;
    return {
      schema: action.inputSchema,
      valid: JSON.parse(await context.executeTool(action, { value: 42, narration: 'Raising the threshold to 42.' })),
      invalid: JSON.parse(
        await context.executeTool(action, { value: 101, narration: 'Raising the threshold to 101.' }),
      ),
      unnarrated: JSON.parse(await context.executeTool(action, { value: 50 })),
      silent: JSON.parse(await context.executeTool(progress, { done: true })),
      observation: JSON.parse(await context.executeTool(observe, {})),
      state: JSON.parse(await context.executeTool(state, {})),
    };
  });
  expect(results.valid.ok).toBe(true);
  expect(results.invalid.ok).toBe(false);
  expect(results.invalid.error.details).toEqual({
    code: 'invalid-params',
    issues: [expect.objectContaining({ path: ['value'], code: 'too_big', message: expect.any(String) })],
  });
  // Chromium replaces a thrown tool error with a generic one, so input problems arrive as results.
  expect(results.unnarrated).toMatchObject({ ok: false, error: { message: 'narration must be a string' } });
  expect(results.silent).toEqual({ ok: false, error: { message: 'message must be a string' } });
  // The action reaches the model as its own tool, with the provider's schema beside its narration.
  expect(results.schema).toEqual(
    expect.objectContaining({
      type: 'object',
      required: ['value', 'narration'],
      properties: expect.objectContaining({ value: { type: 'number', minimum: 0, maximum: 100 } }),
    }),
  );
  expect(results.observation.graph.sources.map((source: { type: string }) => source.type)).toEqual(
    expect.arrayContaining(['parallel-coordinates', 'control']),
  );
  expect(results.observation.graph.nodes.map((node: { ref: string }) => node.ref)).toContain(
    'vacp://example/threshold',
  );
  expect(results.state.mode).toBe('full');
  expect(results.state.snapshot.state['vacp://example/threshold'].value).toBe(42);
  await expect(page.locator('#custom-threshold')).toHaveValue('42');
  await page.evaluate(async (root) => {
    const { uninstallVacpRuntime } = await import(`/@fs${root}/packages/runtime-browser/src/index.ts`);
    uninstallVacpRuntime();
  }, repoRoot);
  await expect
    .poll(() => page.evaluate(async () => (await document.modelContext?.getTools())?.map((tool) => tool.name)))
    .toEqual(['unrelated']);
});

test('native WebMCP accepts generated unions, nullable inputs, and recursive references', async ({ page }) => {
  const server = appServer('cars-parallel-coords');
  await page.addInitScript(() => {
    globalThis.__vacpExampleOptions = { ...globalThis.__vacpExampleOptions, webmcp: false };
  });
  await page.goto(server.url);
  const results = await page.evaluate(async (root) => {
    const { exerciseWebMcpSchemas } = await import(`/@fs${root}/apps/e2e/fixtures/webmcp.ts`);
    return exerciseWebMcpSchemas();
  }, repoRoot);
  expect(results.schemas['schema.action.scalar']).toMatchObject({
    type: 'object',
    required: ['params', 'narration'],
    properties: {
      params: {
        anyOf: [
          { type: 'string', minLength: 1 },
          { type: 'number', minimum: 0 },
        ],
      },
    },
  });
  const schema = results.schemas['schema.action.tree'].properties.params;
  const resolve = (reference: string) => {
    expect(reference).toMatch(/^#\//);
    return reference
      .slice(2)
      .split('/')
      .reduce((value, key) => value[key.replace(/~1/g, '/').replace(/~0/g, '~')], schema);
  };
  const tree = resolve(schema.$ref);
  const children = tree.properties.children.$ref ? resolve(tree.properties.children.$ref) : tree.properties.children;
  expect(schema.$id).toEqual(expect.any(String));
  expect(tree).toMatchObject({ type: 'object', properties: { label: { type: 'string' } } });
  expect(children.type).toBe('array');
  const item = children.items.$ref ? resolve(children.items.$ref) : children.items;
  expect(item).toEqual(tree);
  expect(results.scalar).toMatchObject({ ok: true, result: 4 });
  expect(results.text).toMatchObject({ ok: true, result: 'hello' });
  expect(results.nullable).toMatchObject({ ok: true, result: null });
  expect(results.object).toMatchObject({ ok: true, result: { label: 'leaf' } });
  expect(results.tree).toMatchObject({ ok: true, result: ['root', 'leaf'] });
});

test('native cancellation reaches SDK handlers with DOM publication enabled', async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.__vacpExampleOptions = { ...globalThis.__vacpExampleOptions, webmcp: false, injectDomSnapshot: false };
  });
  await gotoApp(page, 'cars-parallel-coords');
  const result = await page.evaluate(async (root) => {
    const { createVacpActions }: typeof VacpSdk = await import(`/@fs${root}/packages/sdk/src/index.ts`);
    const { createVacpProvider }: typeof VacpRuntime = await import(`/@fs${root}/packages/runtime/src/index.ts`);
    const { installVacpRuntime }: typeof VacpRuntimeBrowser = await import(
      `/@fs${root}/packages/runtime-browser/src/index.ts`
    );
    const { installVacpWebMcp }: typeof VacpWebMcp = await import(`/@fs${root}/packages/transport-webmcp/src/index.ts`);
    let began!: () => void;
    let cancelled!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    const observedCancellation = new Promise<void>((resolve) => {
      cancelled = resolve;
    });
    const actions = createVacpActions();
    actions.operation('mutation', 'wait', 'Wait for cancellation').handle((_params, { signal }) => {
      if (!signal) throw new Error('Execution signal missing');
      began();
      return new Promise((_resolve, reject) =>
        signal.addEventListener(
          'abort',
          () => {
            cancelled();
            reject(signal.reason);
          },
          { once: true },
        ),
      );
    });
    const provider = createVacpProvider({
      source: { id: 'vacp-source://webmcp-cancellation', type: 'test', title: 'Cancellation test' },
      actions: actions.registry,
      project: () => ({ graph: { nodes: [], edges: [], actions: actions.registry.list() }, state: {} }),
      subscribe: () => () => {},
    });
    const integration = installVacpRuntime({ providers: [provider], exposeBridge: true, injectDomSnapshot: true });
    const webmcp = await installVacpWebMcp(integration.runtime);
    if (!webmcp || !document.modelContext) throw new Error('Native WebMCP unavailable');
    try {
      const tool = (await document.modelContext.getTools()).find((entry) => entry.name === 'vacp.action.wait');
      if (!tool) throw new Error('Missing wait tool');
      const controller = new AbortController();
      const execution = document.modelContext
        .executeTool(tool, { narration: 'Waiting for the result.' }, { signal: controller.signal })
        .catch((cause: unknown) => (cause instanceof DOMException ? cause.name : String(cause)));
      await Promise.race([
        started,
        execution.then((result) => {
          throw new Error(`Execution ended before handler started: ${result}`);
        }),
      ]);
      controller.abort();
      await observedCancellation;
      return await execution;
    } finally {
      integration.dispose();
    }
  }, repoRoot);
  expect(result).toBe('AbortError');
});
