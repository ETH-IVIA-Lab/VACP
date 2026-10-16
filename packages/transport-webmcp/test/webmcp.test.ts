import assert from 'node:assert/strict';
import test from 'node:test';
import Ajv from 'ajv/dist/2020.js';
import type { WebMCP } from 'webmcp-types';
import { vacpNarrationGuidance, type VacpGraphFragment } from '@vacp/protocol';
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

/** A runtime with one threshold param. `detail` joins the param's state. */
function fixture(detail: Record<string, unknown> = {}) {
  const actions = new VacpActionRegistry();
  let value = 1;
  const graph: VacpGraphFragment = {
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
    subscribe: () => () => {},
    source: { id: 'vacp-source://webmcp-test', type: 'test', title: 'WebMCP test' },
    actions,
    project: () => {
      return { graph: { ...graph, actions: actions.list() }, state: { 'vacp://app/threshold': { value, ...detail } } };
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
    const result = await action.execute({ value: 35, narration: '  Raising the threshold to 35.  ' }, options);
    assert.equal((result as { ok: boolean }).ok, true);
    assert.deepEqual((await runtime.observe()).state['vacp://app/threshold'], { value: 35 });
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

test('graph reads give the model entities and relationships, and leave actions to their own tools', async () => {
  const { runtime } = fixture();
  try {
    const tools = compileVacpWebMcpTools((await runtime.getCapabilities()).graph, runtime);
    const options = { signal: new AbortController().signal };
    const read = async (name: string) =>
      (await tools.find((tool) => tool.name === name)!.execute({}, options)) as { graph: object; state?: object };
    const { sources, nodes, edges } = (await runtime.getCapabilities()).graph;
    const entities = nodes.map(({ ref, kind, layer, title }) => ({ ref, kind, layer, title }));
    assert.deepEqual((await read('vacp.capabilities')).graph, { sources, nodes: entities, edges });
    const observed = await read('vacp.observe');
    assert.deepEqual(observed.graph, { sources, nodes, edges });
    assert.deepEqual(observed.state, (await runtime.observe()).state);
  } finally {
    runtime.dispose();
  }
});

test('reads and action results reach the model cut to the limits every transport shares', async () => {
  const note = 'x'.repeat(12_001);
  const cut = `${'x'.repeat(11_976)}... [25 more characters]`;
  const { runtime, actions } = fixture({ note });
  actions.register(
    { name: 'note.read', description: 'Read the note', operation: { kind: 'query', affects: [] } },
    () => ({ note }),
  );
  try {
    const tools = compileVacpWebMcpTools((await runtime.getCapabilities()).graph, runtime);
    const call = async (name: string, input: Record<string, unknown> = {}) =>
      (await tools.find((tool) => tool.name === name)!.execute(input, { signal: new AbortController().signal })) as {
        state?: Record<string, { note: string }>;
        snapshot?: { state: Record<string, { note: string }> };
        result?: { note: string };
      };
    assert.equal((await call('vacp.state')).snapshot!.state['vacp://app/threshold']!.note, cut);
    assert.equal((await call('vacp.observe')).state!['vacp://app/threshold']!.note, cut);
    assert.equal((await call('vacp.action.note.read', { narration: 'Reading the note.' })).result!.note, cut);
  } finally {
    runtime.dispose();
  }
});

test('an action call without a usable sentence returns a failure the agent can read and changes nothing', async () => {
  const { runtime } = fixture();
  try {
    const tools = compileVacpWebMcpTools((await runtime.getCapabilities()).graph, runtime);
    const action = tools.find((tool) => tool.name === 'vacp.action.threshold.set')!;
    const options = { signal: new AbortController().signal };
    const missing = (await action.execute({ value: 35 }, options)) as { ok: boolean; error?: { message: string } };
    assert.equal(missing.ok, false);
    assert.equal(missing.error?.message, 'narration must be a string');
    const blank = (await action.execute({ value: 35, narration: '  ' }, options)) as { error?: { message: string } };
    assert.equal(blank.error?.message, 'narration requires a sentence');
    assert.deepEqual((await runtime.observe()).state['vacp://app/threshold'], { value: 1 });
    assert.equal(runtime.getProvenance().records.filter((entry) => entry.kind === 'action').length, 0);
  } finally {
    runtime.dispose();
  }
});

test('non-object inputs use a params envelope, and tool names must be valid and distinct', async () => {
  const { runtime, actions } = fixture();
  actions.register(
    {
      name: 'custom.echo',
      description: 'Echo a scalar',
      operation: { kind: 'evaluation', results: [{ role: 'artifact', mediaType: 'text/plain' }] },
      parameters: { type: 'string', minLength: 1 },
    },
    (input) => input,
  );
  try {
    const graph = (await runtime.getCapabilities()).graph;
    const tools = compileVacpWebMcpTools(graph, runtime, { namespace: 'chart' });
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ['chart.observe', 'chart.capabilities', 'chart.state', 'chart.action.threshold.set', 'chart.action.custom.echo'],
    );
    const result = await tools[4]?.execute(
      { params: 'hello', narration: 'Echoing the word.' },
      { signal: new AbortController().signal },
    );
    assert.equal((result as { result: string }).result, 'hello');
    const echo = graph.actions.find((action) => action.name === 'custom.echo')!;
    assert.throws(
      () => compileVacpWebMcpTools({ ...graph, actions: [{ ...echo, name: 'custom/echo' }] }, runtime),
      /Invalid WebMCP tool name/,
    );
    assert.throws(() => compileVacpWebMcpTools({ ...graph, actions: [echo, echo] }, runtime), /Duplicate/);
  } finally {
    runtime.dispose();
  }
});

test('graph and state reads take the shared tool input fields', async () => {
  const { runtime } = fixture();
  try {
    const tools = compileVacpWebMcpTools((await runtime.getCapabilities()).graph, runtime);
    const read = async (name: string, input: Record<string, unknown>) =>
      (await tools
        .find((tool) => tool.name === name)!
        .execute(input, {
          signal: new AbortController().signal,
        })) as {
        graph?: { nodes: Array<{ ref: string; data?: unknown }> };
        mode?: string;
        token?: string;
        delta?: { changed: object };
      };
    const scoped = await read('vacp.capabilities', { refs: ['vacp://app/threshold'] });
    assert.deepEqual(scoped.graph?.nodes, [
      {
        ref: 'vacp://app/threshold',
        kind: 'Param',
        layer: 'ConfigLayer',
        title: 'Threshold',
        data: { units: 'percent' },
      },
    ]);
    const full = await read('vacp.state', {});
    assert.equal(full.mode, 'full');
    const unchanged = await read('vacp.state', { since: full.token });
    assert.equal(unchanged.mode, 'delta');
    assert.deepEqual(unchanged.delta?.changed, {});
    await assert.rejects(read('vacp.state', { refs: ['app/threshold'] }), /vacp:\/\//);
  } finally {
    runtime.dispose();
  }
});

test('a completed action result stays the answer when the caller aborts after completion', async () => {
  const { runtime, actions } = fixture();
  const controller = new AbortController();
  actions.register({ name: 'finish', description: 'Finish', operation: { kind: 'mutation' } }, () => 'done');
  try {
    const tools = compileVacpWebMcpTools((await runtime.getCapabilities()).graph, runtime);
    const finish = tools.find((tool) => tool.name === 'vacp.action.finish')!;
    runtime.subscribeExecutions((execution) => {
      if (execution.phase === 'succeeded') controller.abort();
    });
    const result = await finish.execute({ narration: 'Finishing the step.' }, { signal: controller.signal });
    assert.deepEqual(result, { callId: (result as { callId: string }).callId, ok: true, result: 'done' });
    assert.equal(controller.signal.aborted, true);
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

test('indirect input schemas retain references inside an object envelope', async () => {
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
    assert.deepEqual((await runtime.observe()).state['vacp://app/threshold'], { value: 1 });
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
      getCapabilities: async () => snapshot,
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
        if (!deferReads) return Promise.resolve(snapshot);
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
    assert.equal(runtime.getAgentActivities()[0]?.actor.id, 'agent', 'narration joins the WebMCP execution actor');
    await context.call('vacp.progress', { message: 'The threshold is 35.', done: true });
    assert.deepEqual(phases, [
      'thinking:Looking at the threshold',
      'thinking:Raising it to 35',
      'completed:The threshold is 35.',
    ]);
    assert.deepEqual(await context.call('vacp.progress', { message: '' }), {
      ok: false,
      error: { message: 'message requires a sentence' },
    });
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

test('object schemas with dialect metadata accept action fields beside narration', async (t) => {
  const { runtime, actions } = fixture();
  t.after(() => runtime.dispose());
  actions.register(
    {
      name: 'with-dialect',
      description: 'Set a value',
      operation: { kind: 'mutation' },
      parameters: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { value: { type: 'number' } },
        required: ['value'],
      },
    },
    (params) => {
      assert.deepEqual(params, { value: 35 });
      return params;
    },
  );
  const tool = compileVacpWebMcpTools((await runtime.getCapabilities()).graph, runtime).find(
    (tool) => tool.name === 'vacp.action.with-dialect',
  )!;
  const input = { value: 35, narration: 'Setting the value to 35.' };
  const validate = new Ajv({ strict: false }).compile(tool.inputSchema!);
  assert.equal(validate(input), true, JSON.stringify(validate.errors));
  const result = await tool.execute(input, { signal: new AbortController().signal });
  assert.ok(result && typeof result === 'object' && 'result' in result);
  assert.deepEqual(result.result, { value: 35 });
});

for (const constraint of [
  { maxProperties: 1 },
  { minProperties: 1 },
  { additionalProperties: false },
  { propertyNames: { enum: ['value'] } },
  { dependentRequired: { other: ['unit'] } },
  { if: { required: ['value'] }, then: { maxProperties: 1 } },
  { patternProperties: { '^narration$': { type: 'number' } } },
  { unevaluatedProperties: false },
  { allOf: [{ maxProperties: 1 }] },
]) {
  test(`whole-object constraint ${Object.keys(constraint).join('/')} keeps its action input semantics`, async (t) => {
    const { runtime, actions } = fixture();
    t.after(() => runtime.dispose());
    const parameters = {
      type: 'object',
      properties: { value: { type: 'number' } },
      required: ['value'],
      ...constraint,
    };
    actions.register(
      { name: 'constrained', description: 'Set a constrained value', operation: { kind: 'mutation' }, parameters },
      (input) => {
        assert.deepEqual(input, { value: 35 });
        return input;
      },
    );
    const tool = compileVacpWebMcpTools((await runtime.getCapabilities()).graph, runtime).find(
      (tool) => tool.name === 'vacp.action.constrained',
    )!;
    const validate = new Ajv({ strict: false }).compile(tool.inputSchema!);
    const input = { params: { value: 35 }, narration: 'Setting the value to 35.' };
    assert.equal(validate(input), true, JSON.stringify(validate.errors));
    const invalidParams =
      'minProperties' in constraint
        ? {}
        : 'patternProperties' in constraint
          ? { value: 35, narration: 'An invalid nested sentence.' }
          : { value: 35, other: true };
    assert.equal(validate({ ...input, params: invalidParams }), false);
    const result = await tool.execute(input, { signal: new AbortController().signal });
    assert.ok(result && typeof result === 'object' && 'result' in result);
    assert.deepEqual(result.result, { value: 35 });
  });
}
