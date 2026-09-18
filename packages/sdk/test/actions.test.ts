import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { VACP_SCHEMA_VERSION, type VacpActionCall, type VacpActionResult } from '@vacp/protocol';
import { createVacpActions, createVacpSnapshotProvider } from '@vacp/sdk';

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
    .action('my-app.select', 'Select named items')
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

  const snapshots = createVacpSnapshotProvider({
    graph: {
      version: VACP_SCHEMA_VERSION,
      nodes: [{ ref: 'vacp://custom/selection', kind: 'Selection', layer: 'InteractionFeedbackLayer', data: selected }],
      edges: [],
    },
    actions: actions.registry,
    getState: (): AppState => ({ 'vacp://custom/selection': selected }),
    getSummary: () => ({ 'vacp://custom/selection': { count: selected.ids.length } }),
  });
  const capabilities = await snapshots.getCapabilities();
  const metadataGroup: string | undefined = capabilities.graph.nodes[0]?.data?.group;
  assert.equal(metadataGroup, 'a');
  const snapshot = await snapshots.getState();
  const group: string = snapshot.state['vacp://custom/selection'].group;
  const count: number | undefined = snapshot.summary?.['vacp://custom/selection'].count;
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
    .action('custom.echo', 'Echo an accepted string')
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
  actions.action('custom.fail', 'Report a domain error').handle(() => {
    throw 42;
  });
  assert.deepEqual(await actions.registry.execute({ callId: 'failure', name: 'custom.fail' }), {
    callId: 'failure',
    ok: false,
    error: { message: '42', details: 42 },
  });
});
