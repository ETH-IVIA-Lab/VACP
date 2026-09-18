import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { VACP_SCHEMA_VERSION, type VacpActionCall, type VacpActionResult } from '@vacp/protocol';
import { createVacpActions, createVacpProvider } from '@vacp/sdk';

interface Selection {
  group: string;
  ids: string[];
}

interface SelectionResult {
  selection: Selection;
  count: number;
}

interface SelectionDescription {
  type: string;
  'x-app-kind': string;
}

interface AppState {
  'vacp://custom/selection': Selection;
}

test('custom actions infer transformed parameters and accept domain interface results', async () => {
  const actions = createVacpActions();
  let selected: Selection = { group: 'initial', ids: [] };
  const params = z
    .object({ group: z.string().min(1), ids: z.array(z.string()).min(1) })
    .transform((value): Selection => ({ ...value, ids: [...new Set(value.ids)] }));

  const description: SelectionDescription = { type: 'object', 'x-app-kind': 'selection' };

  actions
    .operation('mutation', 'my-app.select', 'Select named items')
    .params(description, params)
    .handle(async (selection): Promise<SelectionResult> => {
      selected = selection;
      return { selection, count: selection.ids.length };
    });

  const call: VacpActionCall<Selection, 'my-app.select'> = {
    callId: 'select',
    name: 'my-app.select',
    params: { group: 'a', ids: ['one', 'one', 'two'] },
  };
  assert.deepEqual(await actions.registry.execute(call), {
    callId: 'select',
    ok: true,
    result: { selection: { group: 'a', ids: ['one', 'two'] }, count: 2 },
  });
  assert.equal((await actions.registry.execute({ ...call, params: { group: 'a', ids: [] } })).ok, false);
  assert.deepEqual(selected.ids, ['one', 'two']);
  assert.equal(actions.registry.list()[0]?.parameters?.['x-app-kind'], 'selection');

  const provider = createVacpProvider({
    source: { id: 'vacp-source://custom/selection', type: 'test', title: 'Selection test' },
    actions: actions.registry,
    project: () => ({
      graph: {
        version: VACP_SCHEMA_VERSION,
        nodes: [
          { ref: 'vacp://custom/selection', kind: 'Selection', layer: 'InteractionFeedbackLayer', data: selected },
        ],
        edges: [],
      },
      state: { 'vacp://custom/selection': selected } satisfies AppState,
      summary: { 'vacp://custom/selection': { count: selected.ids.length } },
    }),
  });
  const observation = await provider.observe();
  const metadataGroup: string | undefined = observation.graph.nodes[0]?.data?.group;
  assert.equal(metadataGroup, 'a');
  const group = (observation.state['vacp://custom/selection'] as Selection).group;
  const count = (observation.summary?.['vacp://custom/selection'] as { count?: number } | undefined)?.count;
  assert.equal(group, 'a');
  assert.equal(count, 2);

  const result: VacpActionResult<SelectionResult> = {
    callId: call.callId,
    ok: true,
    result: { selection: selected, count: 2 },
  };
  assert.equal(result.result?.selection.group, 'a');
});

test('application parsers support async validation without a schema library', async () => {
  const actions = createVacpActions();
  actions
    .operation('mutation', 'custom.echo', 'Echo an accepted string')
    .params(
      { type: 'string' },
      {
        async parse(value: unknown) {
          if (typeof value !== 'string') throw new Error('Expected a string');
          return { message: value };
        },
      },
    )
    .handle(({ message }) => message.toUpperCase());

  assert.deepEqual(await actions.registry.execute({ callId: 'ok', name: 'custom.echo', params: 'hello' }), {
    callId: 'ok',
    ok: true,
    result: 'HELLO',
  });
  assert.equal((await actions.registry.execute({ callId: 'bad', name: 'custom.echo', params: 1 })).ok, false);
});

test('application failure details keep their original scalar value', async () => {
  const actions = createVacpActions();
  actions.operation('mutation', 'custom.fail', 'Report a domain error').handle(() => {
    throw 42;
  });
  assert.deepEqual(await actions.registry.execute({ callId: 'failure', name: 'custom.fail' }), {
    callId: 'failure',
    ok: false,
    error: { message: '42', details: 42 },
  });
});

test('scoped action registries retain shared contracts and return their executable identities', async () => {
  const left = createVacpActions('vacp-source://left');
  const right = createVacpActions('vacp-source://right');
  const first = left
    .operation('query', 'inspect', 'Inspect left')
    .contract('domain.inspect')
    .handle(() => 'left');
  const second = right
    .operation('query', 'inspect', 'Inspect right')
    .contract('domain.inspect')
    .handle(() => 'right');
  assert.notEqual(first.name, second.name);
  assert.equal(first.operation.contract, second.operation.contract);
  assert.deepEqual(await left.registry.execute({ callId: 'left', name: first.name }), {
    callId: 'left',
    ok: true,
    result: 'left',
  });
  assert.deepEqual(await right.registry.execute({ callId: 'right', name: second.name }), {
    callId: 'right',
    ok: true,
    result: 'right',
  });
});
