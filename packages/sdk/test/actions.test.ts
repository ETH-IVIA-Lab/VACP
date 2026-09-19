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
  const expected: VacpActionResult<SelectionResult> = {
    callId: 'select',
    ok: true,
    result: { selection: { group: 'a', ids: ['one', 'two'] }, count: 2 },
  };
  assert.deepEqual(await actions.registry.execute(call), expected);
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
        actions: actions.registry.list(),
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

test('composed prerequisites and typed focus survive the action definition stages', async () => {
  const actions = createVacpActions();
  const definition = actions
    .operation('mutation', 'select', 'Select an item')
    .requires('vacp://dataset')
    .requires('vacp://chart', 'vacp://dataset')
    .params(
      { type: 'string' },
      z.string().transform((id) => ({ id })),
    )
    .title('Select item')
    .focus(({ id }) => ({ ref: 'vacp://chart', detail: { id }, interaction: { kind: 'activate' } })) satisfies {
    focus: unknown;
    params?: never;
  };
  const descriptor = definition.handle(({ id }) => id);
  assert.deepEqual(descriptor.availability?.requires, ['vacp://dataset', 'vacp://chart']);
  const prepared = await actions.registry.prepare({ callId: 'select', name: descriptor.name, params: 'point-1' });
  assert.deepEqual(prepared.intent.focus, {
    ref: 'vacp://chart',
    detail: { id: 'point-1' },
    interaction: { kind: 'activate' },
  });
  assert.deepEqual(await prepared.execute(), { callId: 'select', ok: true, result: 'point-1' });

  const unparsed = actions.operation('query', 'inspect', 'Inspect chart');
  unparsed.focus(() => ({ ref: 'vacp://chart' })).title('Inspect chart') satisfies { focus: unknown; params?: never };
  assert.throws(() => unparsed.params({ type: 'string' }), /parameters once, before focus/);
});

test('a projection owns live action descriptions and state without changing the execution registry', async () => {
  const actions = createVacpActions();
  actions.operation('mutation', 'selection.clear', 'Clear the selection').handle(() => {});
  let selected = false;
  const provider = createVacpProvider({
    source: { id: 'vacp-source://selection', type: 'test', title: 'Selection' },
    actions: actions.registry,
    project: () => {
      const current = selected;
      return {
        graph: {
          version: VACP_SCHEMA_VERSION,
          nodes: [{ ref: 'vacp://selection', kind: 'Selection', layer: 'InteractionFeedbackLayer' }],
          edges: [],
          actions: actions.registry.list().map((action) => ({
            ...action,
            availability: { unavailable: current ? undefined : 'No selection to clear' },
          })),
        },
        state: { 'vacp://selection': current },
      };
    },
  });
  const empty = await provider.observe();
  assert.equal(empty.graph.actions[0]?.availability?.unavailable, 'No selection to clear');
  assert.equal(empty.state['vacp://selection'], false);
  selected = true;
  const populated = await provider.observe();
  assert.equal(populated.graph.actions[0]?.availability?.unavailable, undefined);
  assert.equal(populated.state['vacp://selection'], true);
  assert.notEqual(populated.revision, empty.revision);
  assert.equal(actions.registry.list()[0]?.availability, undefined);
});

test('parameter definitions own their relationship metadata', () => {
  const actions = createVacpActions();
  const base = actions.operation('mutation', 'set', 'Set value').affects('vacp://shared');
  const defined = base.params({ type: 'number' }, z.number()).affects('vacp://value');
  base.affects('vacp://other');
  assert.deepEqual(defined.handle((value) => value).operation.affects, ['vacp://shared', 'vacp://value']);
});
