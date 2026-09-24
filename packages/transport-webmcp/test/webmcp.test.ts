import assert from 'node:assert/strict';
import test from 'node:test';
import type { WebMCP } from 'webmcp-types';
import { VACP_SCHEMA_VERSION, vacpNarrationGuidance, type VacpGraph, type VacpGraphFragment } from '@vacp/protocol';
import { createVacpProvider, createVacpRuntime, VacpActionRegistry } from '@vacp/runtime';
import { compileVacpWebMcpTools, installVacpWebMcp, type VacpWebMcpRegistry } from '../src/index';

class Registry implements VacpWebMcpRegistry {
  tools = new Map<string, WebMCP.ModelContextTool>();
  onRegister?: (tool: WebMCP.ModelContextTool) => void;
  async registerTool(tool: WebMCP.ModelContextTool, options?: WebMCP.ModelContextRegisterToolOptions) {
    options?.signal?.throwIfAborted();
    if (this.tools.has(tool.name)) throw new Error(`Duplicate: ${tool.name}`);
    this.tools.set(tool.name, tool);
    this.onRegister?.(tool);
    options?.signal?.addEventListener(
      'abort',
      () => {
        if (this.tools.get(tool.name) === tool) this.tools.delete(tool.name);
      },
      { once: true },
    );
  }
  /** Action tools require the step's sentence; calls that do not test narration get a neutral one. */
  async call(name: string, input: Record<string, unknown> = {}, signal = new AbortController().signal) {
    const tool = this.tools.get(name);
    assert.ok(tool, name);
    return tool.execute(name.includes('.action.') ? { narration: 'Adjusting the chart.', ...input } : input, {
      signal,
    });
  }
}

function fixture() {
  const actions = new VacpActionRegistry();
  let value = 1;
  const graph: VacpGraphFragment = {
    version: VACP_SCHEMA_VERSION,
    nodes: [
      { ref: 'vacp://app', kind: 'App', layer: 'ViewLayer', title: 'Application' },
      {
        ref: 'vacp://app/threshold',
        kind: 'Param',
        layer: 'ConfigLayer',
        title: 'Threshold',
        data: { units: 'percent' },
      },
    ],
    edges: [{ from: 'vacp://app', to: 'vacp://app/threshold', kind: 'contains' }],
    actions: [],
  };
  actions.register(
    {
      name: 'threshold.set',
      description: 'Set threshold',
      operation: { kind: 'mutation', affects: ['vacp://app/threshold'] },
      parameters: { type: 'object', properties: { value: { type: 'number' } } },
    },
    (input) => {
      if (!input || typeof input !== 'object' || !('value' in input) || typeof input.value !== 'number')
        throw new Error('Expected value');
      value = input.value;
      return { value };
    },
  );
  const provider = createVacpProvider({
    source: { id: 'vacp-source://webmcp-test', type: 'test', title: 'WebMCP test' },
    actions,
    project: () => {
      return { graph: { ...graph, actions: actions.list() }, state: { 'vacp://app/threshold': { value } } };
    },
  });
  const runtime = createVacpRuntime({ providers: [provider] });
  return { actions, graph, runtime };
}

test('graph projection preserves schemas and context, and executes through runtime history', async () => {
  const { runtime } = fixture();
  try {
    const graph = (await runtime.getCapabilities()).graph;
    const tools = compileVacpWebMcpTools(graph, runtime);
    const action = tools.find((tool) => tool.name === 'vacp.action.threshold.set');
    assert.ok(action);
    assert.match(action.description, /Threshold.*ConfigLayer/);
    const parameters = graph.actions[0]!.parameters as { properties: object };
    assert.deepEqual(action.inputSchema, {
      ...parameters,
      properties: {
        ...parameters.properties,
        narration: { type: 'string', minLength: 1, maxLength: 280, description: vacpNarrationGuidance },
      },
      required: ['narration'],
    });
    assert.equal(tools[0]?.annotations?.readOnlyHint, true);
    const options = { signal: new AbortController().signal };
    assert.deepEqual(
      ((await tools[0]!.execute({}, options)) as { graph: VacpGraph }).graph,
      (await runtime.getCapabilities()).graph,
    );
    const result = await action.execute({ value: 35, narration: '  Raising the threshold to 35.  ' }, options);
    assert.equal((result as { ok: boolean }).ok, true);
    assert.deepEqual((await runtime.getState()).state['vacp://app/threshold'], { value: 35 });
    const record = runtime
      .getProvenance()
      .records.filter((entry) => entry.kind === 'action')
      .at(-1);
    assert.equal(record?.call.name, 'threshold.set');
    // The step's sentence is not an action parameter; the execution carries it.
    assert.deepEqual(record?.kind === 'action' ? record.call.params : undefined, { value: 35 });
    assert.equal(record?.kind === 'action' && record.execution.narration, 'Raising the threshold to 35.');
  } finally {
    runtime.dispose();
  }
});

test('non-object inputs use a params envelope while custom naming and selection stay optional', async () => {
  const { runtime, actions } = fixture();
  actions.register(
    {
      name: 'custom/echo',
      description: 'Echo a scalar',
      operation: { kind: 'evaluation', results: [{ role: 'artifact', mediaType: 'text/plain' }] },
      parameters: { type: 'string', minLength: 1 },
    },
    (input) => input,
  );
  try {
    const tools = compileVacpWebMcpTools((await runtime.getCapabilities()).graph, runtime, {
      namespace: 'chart',
      includeAction: (action) => action.name === 'custom/echo',
      actionName: () => 'chart.echo',
    });
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ['chart.observe', 'chart.capabilities', 'chart.state', 'chart.echo'],
    );
    const result = await tools[3]?.execute(
      { params: 'hello', narration: 'Echoing the word.' },
      { signal: new AbortController().signal },
    );
    assert.equal((result as { result: string }).result, 'hello');
    const currentGraph = (await runtime.getCapabilities()).graph;
    assert.throws(
      () => compileVacpWebMcpTools({ ...currentGraph, nodes: [], edges: [], actions: actions.list() }, runtime),
      /Invalid WebMCP tool name/,
    );
    assert.throws(
      () =>
        compileVacpWebMcpTools({ ...currentGraph, nodes: [], edges: [], actions: actions.list() }, runtime, {
          actionName: () => 'vacp.state',
        }),
      /Duplicate/,
    );
  } finally {
    runtime.dispose();
  }
});

test('automatic registration follows graph changes, preserves foreign tools, and owns its lifetime', async () => {
  const { runtime, actions, graph } = fixture();
  const context = new Registry();
  await context.registerTool({ name: 'foreign', description: 'Unrelated tool', execute: () => 'foreign' });
  const registration = await installVacpWebMcp(runtime, { context });
  assert.ok(registration);
  try {
    const original = [...context.tools.values()];
    await runtime.refresh();
    await registration.refresh();
    for (const tool of original) {
      assert.equal(context.tools.get(tool.name), tool, 'timestamp-only changes retain native registrations');
    }
    actions.unregister('threshold.set');
    const registered = new Promise<void>((resolve) => {
      context.onRegister = (tool) => {
        if (tool.name === 'vacp.action.reset') resolve();
      };
    });
    actions.register(
      {
        name: 'reset',
        description: 'Reset selection',
        operation: { kind: 'mutation', affects: ['vacp://app/threshold'] },
      },
      () => 'reset',
    );
    await runtime.refresh();
    await registered;
    assert.equal(context.tools.has('vacp.action.threshold.set'), false);
    const result = await context.call('vacp.action.reset');
    assert.ok(result && typeof result === 'object' && 'result' in result);
    assert.equal(result.result, 'reset');
  } finally {
    registration.dispose();
    assert.deepEqual([...context.tools.keys()], ['foreign']);
  }
  const again = await installVacpWebMcp(runtime, { context });
  assert.ok(again);
  graph.nodes[1]!.title = 'Changed threshold';
  await runtime.refresh();
  await again.refresh();
  assert.match(context.tools.get('vacp.action.reset')?.description ?? '', /Changed threshold/);
  runtime.dispose();
  assert.deepEqual([...context.tools.keys()], ['foreign']);
  await assert.rejects(again.refresh(), /abort/i);
});

test('indirect input schemas retain references inside an object envelope, and object mode needs an object root', async () => {
  const { runtime, actions } = fixture();
  const parameters = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $ref: '#/$defs/input',
    $defs: { input: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] } },
  };
  actions.register(
    { name: 'indirect', description: 'Echo an indirect input', operation: { kind: 'query' }, parameters },
    (input) => input,
  );
  try {
    const graph = (await runtime.getCapabilities()).graph;
    const tool = compileVacpWebMcpTools(graph, runtime).find((entry) => entry.name === 'vacp.action.indirect')!;
    assert.deepEqual(tool.inputSchema, {
      type: 'object',
      properties: {
        params: { ...parameters, $id: 'urn:vacp:webmcp:vacp.action.indirect' },
        narration: { type: 'string', minLength: 1, maxLength: 280, description: vacpNarrationGuidance },
      },
      required: ['params', 'narration'],
      additionalProperties: false,
    });
    assert.equal(
      (
        (await tool.execute(
          { params: null, narration: 'Clearing the value.' },
          { signal: new AbortController().signal },
        )) as { result: unknown }
      ).result,
      null,
    );
    assert.throws(
      () => compileVacpWebMcpTools(graph, runtime, { inputMode: () => 'object' }),
      /vacp.action.indirect needs inputMode 'params'/,
    );
  } finally {
    runtime.dispose();
  }
});

test('a conflicting registration rolls back only this adapter and releases subscriptions', async () => {
  const { runtime } = fixture();
  const context = new Registry();
  const foreign: WebMCP.ModelContextTool = {
    name: 'vacp.action.threshold.set',
    description: 'Owned by someone else',
    execute: () => 'foreign',
  };
  await context.registerTool(foreign);
  try {
    await assert.rejects(installVacpWebMcp(runtime, { context }), (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /registration failed for vacp.action.threshold.set/);
      assert.ok(error.cause instanceof Error);
      assert.match(error.cause.message, /Duplicate/);
      return true;
    });
    assert.deepEqual([...context.tools.values()], [foreign]);
  } finally {
    runtime.dispose();
  }
});

test('browser cancellation reaches the application handler; revoked tools cannot execute', async () => {
  const { runtime, actions } = fixture();
  let started!: () => void;
  const didStart = new Promise<void>((resolve) => {
    started = resolve;
  });
  let observedAbort = false;
  actions.register(
    { name: 'wait', description: 'Wait until cancelled', operation: { kind: 'evaluation' } },
    async (_params, { signal }) => {
      assert.ok(signal);
      started();
      return new Promise<void>((_resolve, reject) =>
        signal.addEventListener(
          'abort',
          () => {
            observedAbort = true;
            reject(signal.reason);
          },
          { once: true },
        ),
      );
    },
  );
  const context = new Registry();
  const registration = await installVacpWebMcp(runtime, { context });
  assert.ok(registration);
  try {
    const controller = new AbortController();
    const call = context.call('vacp.action.wait', {}, controller.signal);
    const rejected = assert.rejects(call, /abort/i);
    await didStart;
    controller.abort();
    await rejected;
    assert.equal(observedAbort, true);
    const stale = context.tools.get('vacp.action.threshold.set');
    assert.ok(stale);
    registration.dispose();
    await assert.rejects(
      Promise.resolve(
        stale.execute({ value: 88, narration: 'Raising it to 88.' }, { signal: new AbortController().signal }),
      ),
      /abort/i,
    );
    assert.deepEqual((await runtime.getState()).state['vacp://app/threshold'], { value: 1 });
  } finally {
    runtime.dispose();
  }
});

test('unsupported environments leave the runtime untouched', async () => {
  const { runtime } = fixture();
  try {
    assert.equal(await installVacpWebMcp(runtime), undefined);
  } finally {
    runtime.dispose();
  }
});

test('aborting installation during discovery removes its subscription without waiting for the provider', async () => {
  const { runtime } = fixture();
  let detached = 0;
  let release!: (value: Awaited<ReturnType<typeof runtime.getCapabilities>>) => void;
  const snapshot = await runtime.getCapabilities();
  const context = new Registry();
  const controller = new AbortController();
  const installing = installVacpWebMcp(
    {
      ...runtime,
      subscribeCapabilities: () => () => {
        detached++;
      },
      getCapabilities: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    },
    { context, signal: controller.signal },
  );
  await Promise.resolve();
  const rejected = assert.rejects(installing, /abort/i);
  controller.abort();
  await rejected;
  assert.equal(detached, 1);
  assert.equal(context.tools.size, 0);
  release(snapshot);
  runtime.dispose();
});

test('an invalid updated catalog withdraws owned tools and can recover on refresh', async () => {
  const { runtime, actions } = fixture();
  const context = new Registry();
  const registration = await installVacpWebMcp(runtime, { context });
  assert.ok(registration);
  try {
    actions.register(
      { name: 'invalid/name', description: 'Invalid native name', operation: { kind: 'evaluation' } },
      () => null,
    );
    await assert.rejects(registration.refresh(), /Invalid WebMCP tool name/);
    assert.equal(context.tools.size, 0);
    assert.ok(registration.error instanceof Error);
    actions.unregister('invalid/name');
    await registration.refresh();
    assert.equal(context.tools.size, 5);
    assert.equal(registration.error, undefined);
  } finally {
    runtime.dispose();
  }
});

test('an action can update its own metadata without cancelling its successful result', async () => {
  const { runtime, actions, graph } = fixture();
  actions.unregister('threshold.set');
  actions.register(
    {
      name: 'retitle',
      description: 'Change the title',
      operation: { kind: 'mutation', affects: ['vacp://app/threshold'] },
    },
    () => {
      graph.nodes[1]!.title = 'Updated title';
      return 'changed';
    },
  );
  const context = new Registry();
  const registration = await installVacpWebMcp(runtime, { context });
  assert.ok(registration);
  try {
    const result = await context.call('vacp.action.retitle');
    assert.ok(result && typeof result === 'object' && 'result' in result);
    assert.equal(result.result, 'changed');
    await registration.refresh();
    assert.match(context.tools.get('vacp.action.retitle')?.description ?? '', /Updated title/);
  } finally {
    runtime.dispose();
  }
});

test('catalog bursts merge waiting revisions and refresh waits for the latest registration', async () => {
  const { runtime } = fixture();
  let snapshot = await runtime.getCapabilities();
  let publish!: (value: typeof snapshot) => void;
  let unblockFirst!: () => void;
  let unblockLatest!: () => void;
  let firstStarted!: () => void;
  let latestStarted!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    unblockFirst = resolve;
  });
  const latestGate = new Promise<void>((resolve) => {
    unblockLatest = resolve;
  });
  const firstReady = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  const latestReady = new Promise<void>((resolve) => {
    latestStarted = resolve;
  });
  const registry = new Registry();
  const revisions: string[] = [];
  const registration = await installVacpWebMcp(
    {
      ...runtime,
      getCapabilities: () => snapshot,
      subscribeCapabilities: (listener) => {
        publish = listener;
        return () => {};
      },
    },
    {
      context: {
        registerTool: async (tool, options) => {
          await registry.registerTool(tool, options);
          if (tool.name === 'vacp.action.threshold.set') revisions.push(tool.description.split('\n')[0]!);
          if (tool.description.startsWith('Blocking')) {
            firstStarted();
            await firstGate;
          }
          if (tool.description.startsWith('Latest')) {
            latestStarted();
            await latestGate;
          }
        },
      },
    },
  );
  assert.ok(registration);
  const revise = (description: string) => {
    snapshot = {
      ...snapshot,
      graph: { ...snapshot.graph, actions: snapshot.graph.actions.map((action) => ({ ...action, description })) },
    };
    publish(snapshot);
  };
  try {
    revise('Blocking revision');
    await firstReady;
    revise('Superseded revision');
    revise('Latest revision');
    let finished = false;
    const refresh = registration.refresh().then(() => {
      finished = true;
    });
    unblockFirst();
    await latestReady;
    assert.equal(finished, false, 'refresh must await the pending native registration');
    unblockLatest();
    await refresh;
    assert.equal(finished, true);
    assert.deepEqual(revisions, ['Set threshold', 'Blocking revision', 'Latest revision']);
    assert.match(registry.tools.get('vacp.action.threshold.set')?.description ?? '', /^Latest revision/);
  } finally {
    unblockFirst();
    unblockLatest();
    registration.dispose();
    runtime.dispose();
  }
});

test('a subscription supersedes a pending discovery read without restoring withdrawn actions', async () => {
  const { runtime } = fixture();
  const snapshot = await runtime.getCapabilities();
  const latest = { ...snapshot, graph: { ...snapshot.graph, actions: [] } };
  let publish!: (value: typeof snapshot) => void;
  let release!: (value: typeof snapshot) => void;
  let markStarted!: () => void;
  const reading = new Promise<typeof snapshot>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const context = new Registry();
  const installing = installVacpWebMcp(
    {
      ...runtime,
      subscribeCapabilities: (listener) => {
        publish = listener;
        return () => {};
      },
      getCapabilities: () => {
        markStarted();
        return reading;
      },
    },
    { context },
  );
  try {
    await started;
    publish(latest);
    release(snapshot);
    const registration = await installing;
    assert.ok(registration);
    assert.deepEqual(
      new Set(context.tools.keys()),
      new Set(['vacp.observe', 'vacp.capabilities', 'vacp.state', 'vacp.progress']),
    );
    assert.deepEqual(new Set(registration.toolNames), new Set(context.tools.keys()));
    registration.dispose();
  } finally {
    release(snapshot);
    runtime.dispose();
  }
});

test('overlapping refreshes await the newest discovery and ignore stale failures', async () => {
  const { runtime } = fixture();
  const snapshot = await runtime.getCapabilities();
  const latest = {
    ...snapshot,
    graph: {
      ...snapshot.graph,
      actions: snapshot.graph.actions.map((action) => ({ ...action, description: 'Latest description' })),
    },
  };
  const reads: Array<{ resolve: (value: typeof snapshot) => void; reject: (cause: Error) => void }> = [];
  const context = new Registry();
  let deferReads = false;
  const registration = await installVacpWebMcp(
    {
      ...runtime,
      subscribeCapabilities: () => () => {},
      getCapabilities: () => {
        if (!deferReads) return snapshot;
        return new Promise<typeof snapshot>((resolve, reject) => {
          reads.push({ resolve, reject });
        });
      },
    },
    { context },
  );
  assert.ok(registration);
  try {
    deferReads = true;
    let firstFinished = false;
    const first = registration.refresh().then(() => {
      firstFinished = true;
    });
    const second = registration.refresh();
    await Promise.resolve();
    reads[0]!.reject(new Error('Superseded discovery failed'));
    await Promise.resolve();
    assert.equal(firstFinished, false);
    reads[1]!.resolve(latest);
    await Promise.all([first, second]);
    assert.match(context.tools.get('vacp.action.threshold.set')?.description ?? '', /^Latest description/);
    assert.equal(registration.error, undefined);
  } finally {
    for (const read of reads) read.resolve(snapshot);
    registration.dispose();
    runtime.dispose();
  }
});

test('a progress tool narrates one public activity per turn and closes forgotten turns', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { runtime } = fixture();
  const context = new Registry();
  const phases: string[] = [];
  runtime.subscribeAgentActivities((activity) => phases.push(`${activity.phase}:${activity.summary ?? ''}`));
  const registration = await installVacpWebMcp(runtime, { context });
  assert.ok(registration);
  try {
    const progress = context.tools.get('vacp.progress');
    assert.ok(progress, 'a runtime that publishes activity receives the progress tool');
    assert.match(progress.description, /one short plain sentence/);
    await context.call('vacp.progress', { message: 'Looking at the threshold' });
    await context.call('vacp.progress', { message: 'Raising it to 35' });
    await context.call('vacp.action.threshold.set', { value: 35 });
    assert.equal(runtime.getAgentActivities()[0]?.summary, 'Raising it to 35');
    assert.equal(runtime.getAgentActivities()[0]?.actor.id, 'webmcp', 'narration joins the WebMCP execution actor');
    await context.call('vacp.progress', { message: 'The threshold is 35.', done: true });
    assert.deepEqual(phases, [
      'thinking:Looking at the threshold',
      'thinking:Raising it to 35',
      'completed:The threshold is 35.',
    ]);
    await assert.rejects(context.call('vacp.progress', { message: '' }), /requires a sentence/);
    await context.call('vacp.progress', { message: 'Checking again' });
    t.mock.timers.tick(60_000);
    assert.equal(runtime.getAgentActivities().length, 0, 'a quiet turn closes on its own');
    assert.equal(phases.at(-1), 'completed:Checking again', 'a quiet close keeps the last words');
    await context.call('vacp.progress', { message: 'One more look' });
  } finally {
    registration.dispose();
  }
  assert.equal(phases.at(-1), 'cancelled:One more look', 'disposal releases an open turn');
  runtime.dispose();
});

test('every narrated action carries its own sentence from acceptance, beside the turn the progress tool opened', async () => {
  const { runtime } = fixture();
  const context = new Registry();
  const accepted: (string | undefined)[] = [];
  runtime.subscribeExecutions((execution) => {
    if (execution.phase === 'accepted') accepted.push(execution.narration);
  });
  const registration = await installVacpWebMcp(runtime, { context });
  assert.ok(registration);
  try {
    await context.call('vacp.progress', { message: 'Tuning the threshold for the person.' });
    await context.call('vacp.action.threshold.set', { value: 20, narration: 'Lowering the threshold to 20.' });
    await context.call('vacp.action.threshold.set', { value: 35, narration: 'Raising it to 35 to drop noise.' });
    assert.deepEqual(accepted, ['Lowering the threshold to 20.', 'Raising it to 35 to drop noise.']);
    assert.equal(runtime.getAgentActivities()[0]?.summary, 'Tuning the threshold for the person.');
    const steps = runtime.getProvenance().records.filter((record) => record.kind === 'action');
    const turn = runtime.getAgentActivities()[0]!.id;
    assert.deepEqual(
      steps.map((record) => record.kind === 'action' && record.execution.activityId),
      [turn, turn],
    );
  } finally {
    registration.dispose();
    runtime.dispose();
  }
});
