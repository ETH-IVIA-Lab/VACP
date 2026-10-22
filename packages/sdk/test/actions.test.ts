import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import * as mini from 'zod/mini';
import { VacpActionError, vacpAgentActor, type VacpActionCall, type VacpActionResult } from '@ethivia/vacp-protocol';
import { createVacpProvider, executeVacpAction } from '@ethivia/vacp-runtime';
import { createVacpActions } from '@ethivia/vacp-sdk';

const context = { actor: vacpAgentActor };

interface Selection {
  group: string;
  ids: string[];
}

interface SelectionResult {
  selection: Selection;
  count: number;
}

interface AppState {
  'vacp://custom/selection': Selection;
}

test('custom actions infer transformed parameters and accept domain interface results', async () => {
  const actions = createVacpActions();
  let selected: Selection = { group: 'initial', ids: [] };
  const params = z
    .object({ group: z.string().min(1), ids: z.array(z.string()).min(1) })
    .transform((value): Selection => ({ ...value, ids: [...new Set(value.ids)] }))
    .meta({ 'x-app-kind': 'selection' });

  actions
    .operation('mutation', 'my-app.select', 'Select named items')
    .params(params)
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
  assert.deepEqual(await executeVacpAction(actions.registry, call, context), expected);
  assert.equal(
    (await executeVacpAction(actions.registry, { ...call, params: { group: 'a', ids: [] } }, context)).ok,
    false,
  );
  assert.deepEqual(selected.ids, ['one', 'two']);
  assert.equal(actions.registry.list()[0]?.parameters?.['x-app-kind'], 'selection');

  const provider = createVacpProvider({
    subscribe: () => () => {},
    source: { id: 'vacp-source://custom/selection', type: 'test', title: 'Selection test' },
    actions: actions.registry,
    project: () => ({
      graph: {
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

test('async Zod validation and transforms feed normalized parameters to the handler', async () => {
  const actions = createVacpActions();
  const descriptor = actions
    .operation('mutation', 'custom.echo', 'Echo an accepted string')
    .params(
      z
        .string()
        .refine(async (value) => value.length > 0)
        .transform(async (message) => ({ message })),
    )
    .handle(({ message }) => message.toUpperCase());

  assert.equal(descriptor.parameters?.type, 'string');
  assert.deepEqual(
    await executeVacpAction(actions.registry, { callId: 'ok', name: 'custom.echo', params: 'hello' }, context),
    {
      callId: 'ok',
      ok: true,
      result: 'HELLO',
    },
  );
  assert.equal(
    (await executeVacpAction(actions.registry, { callId: 'bad', name: 'custom.echo', params: '' }, context)).ok,
    false,
  );
});

test('application failure details preserve scalar values and explicit domain diagnostics', async () => {
  const actions = createVacpActions();
  actions.operation('mutation', 'custom.fail', 'Report a domain error').handle(() => {
    throw 42;
  });
  assert.deepEqual(await executeVacpAction(actions.registry, { callId: 'failure', name: 'custom.fail' }, context), {
    callId: 'failure',
    ok: false,
    error: { message: '42', details: 42 },
  });
  actions.operation('query', 'custom.rows', 'Read available rows').handle(() => {
    throw new VacpActionError('Dataset is still loading', { code: 'loading', dataset: 'cars' });
  });
  assert.deepEqual(await executeVacpAction(actions.registry, { callId: 'rows', name: 'custom.rows' }, context), {
    callId: 'rows',
    ok: false,
    error: { message: 'Dataset is still loading', details: { code: 'loading', dataset: 'cars' } },
  });
  actions.operation('query', 'custom.crash', 'Fail unexpectedly').handle(() => {
    throw new Error('Connection lost', { cause: new Error('socket closed') });
  });
  assert.deepEqual(await executeVacpAction(actions.registry, { callId: 'crash', name: 'custom.crash' }, context), {
    callId: 'crash',
    ok: false,
    error: { message: 'Connection lost' },
  });
});

test('invalid parameters report structured field diagnostics before invoking the handler', async () => {
  const actions = createVacpActions();
  actions
    .operation('mutation', 'set', 'Set item counts')
    .params(z.object({ items: z.array(z.object({ count: z.number().min(1, 'Choose a positive count') })) }))
    .handle(() => {
      throw new Error('Validation must run before the handler');
    });
  assert.deepEqual(
    await executeVacpAction(
      actions.registry,
      { callId: 'invalid', name: 'set', params: { items: [{ count: 0 }] } },
      context,
    ),
    {
      callId: 'invalid',
      ok: false,
      error: {
        message: 'Invalid parameters for action "set"',
        details: {
          code: 'invalid-params',
          issues: [{ path: ['items', 0, 'count'], code: 'too_small', message: 'Choose a positive count' }],
        },
      },
    },
  );
});

test('union diagnostics retain branch and nested key failures without copying submitted values', async () => {
  const actions = createVacpActions();
  actions
    .operation('query', 'select', 'Select fields or a saved name')
    .params(
      z.union(
        [
          z.record(z.string().regex(/^field_/, 'Use a field_ key'), z.number(), { error: 'Invalid field map' }),
          z.string({ error: 'Use a saved name' }),
        ],
        { error: 'Choose a field map or a saved name' },
      ),
    )
    .handle((value) => value);
  assert.deepEqual(
    await executeVacpAction(actions.registry, { callId: 'union', name: 'select', params: { other: 17 } }, context),
    {
      callId: 'union',
      ok: false,
      error: {
        message: 'Invalid parameters for action "select"',
        details: {
          code: 'invalid-params',
          issues: [
            {
              path: [],
              code: 'invalid_union',
              message: 'Choose a field map or a saved name',
              errors: [
                [
                  {
                    path: ['other'],
                    code: 'invalid_key',
                    message: 'Invalid field map',
                    issues: [{ path: [], code: 'invalid_format', message: 'Use a field_ key' }],
                  },
                ],
                [{ path: [], code: 'invalid_type', message: 'Use a saved name' }],
              ],
            },
          ],
        },
      },
    },
  );
});

test('application exceptions from parameter transforms retain their identity', async () => {
  const actions = createVacpActions();
  const failure = new Error('Lookup unavailable');
  actions
    .operation('query', 'lookup', 'Look up a value')
    .params(
      z.string().transform(() => {
        throw failure;
      }),
    )
    .handle(() => undefined);
  await assert.rejects(
    actions.registry.prepare({ callId: 'lookup', name: 'lookup', params: 'cars' }),
    (error) => error === failure,
  );
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
  assert.deepEqual(await executeVacpAction(left.registry, { callId: 'left', name: first.name }, context), {
    callId: 'left',
    ok: true,
    result: 'left',
  });
  assert.deepEqual(await executeVacpAction(right.registry, { callId: 'right', name: second.name }, context), {
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
    .params(z.string().transform((id) => ({ id })))
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
  assert.deepEqual(await prepared.execute(context), { callId: 'select', ok: true, result: 'point-1' });

  const unparsed = actions.operation('query', 'inspect', 'Inspect chart');
  unparsed.focus(() => ({ ref: 'vacp://chart' })).title('Inspect chart') satisfies { focus: unknown; params?: never };
  assert.throws(() => unparsed.params(z.string()), /parameters once, before focus/);
});

test('a projection owns live action descriptions and state without changing the execution registry', async () => {
  const actions = createVacpActions();
  actions.operation('mutation', 'selection.clear', 'Clear the selection').handle(() => {});
  let selected = false;
  const provider = createVacpProvider({
    subscribe: () => () => {},
    source: { id: 'vacp-source://selection', type: 'test', title: 'Selection' },
    actions: actions.registry,
    project: () => {
      const current = selected;
      return {
        graph: {
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
  const defined = base.params(z.number()).affects('vacp://value');
  base.affects('vacp://other');
  assert.deepEqual(defined.handle((value) => value).operation.affects, ['vacp://shared', 'vacp://value']);
});

test('one schema publishes input constraints and prepares coerced values and defaults', async () => {
  const actions = createVacpActions();
  const descriptor = actions
    .operation('mutation', 'brush', 'Brush ranges')
    .params(
      z.object({
        ranges: z
          .record(z.string(), z.tuple([z.coerce.number(), z.coerce.number()]).nullable())
          .describe('Ranges by field'),
        mode: z.enum(['replace', 'extend']).default('replace'),
      }),
    )
    .focus(({ ranges }) => ({ ref: 'vacp://chart', detail: { ranges } }))
    .handle(({ ranges, mode }) => {
      const parsed: Record<string, [number, number] | null> = ranges;
      const operation: 'replace' | 'extend' = mode;
      return { ranges: parsed, mode: operation };
    });
  assert.deepEqual(descriptor.parameters?.required, ['ranges']);
  assert.partialDeepStrictEqual(descriptor.parameters?.properties, {
    ranges: { description: 'Ranges by field' },
    mode: { type: 'string', enum: ['replace', 'extend'], default: 'replace' },
  });
  const prepared = await actions.registry.prepare({
    callId: 'brush',
    name: descriptor.name,
    params: { ranges: { x: ['2', '6'], y: null } },
  });
  assert.deepEqual(prepared.intent.focus?.detail, { ranges: { x: [2, 6], y: null } });
  assert.deepEqual(await prepared.execute(context), {
    callId: 'brush',
    ok: true,
    result: { ranges: { x: [2, 6], y: null }, mode: 'replace' },
  });
  assert.equal(
    (
      await executeVacpAction(
        actions.registry,
        {
          callId: 'invalid',
          name: descriptor.name,
          params: { ranges: { x: [1] } },
        },
        context,
      )
    ).ok,
    false,
  );
});

test('Zod Mini schemas infer handler parameters', async () => {
  const actions = createVacpActions();
  const minimal = actions
    .operation('query', 'double', 'Double a value')
    .params(mini.object({ value: mini.number() }))
    .handle(({ value }) => value * 2);
  assert.deepEqual(
    await executeVacpAction(actions.registry, { callId: 'mini', name: minimal.name, params: { value: 3 } }, context),
    {
      callId: 'mini',
      ok: true,
      result: 6,
    },
  );
});

test('unrepresentable input fails during definition while JSON inputs may transform to domain values', async () => {
  const actions = createVacpActions();
  assert.throws(
    () => actions.operation('query', 'invalid', 'Invalid input').params(z.date()),
    (error) => error instanceof Error && /action "invalid".*Date/.test(error.message) && error.cause instanceof Error,
  );
  assert.deepEqual(actions.registry.list(), []);
  const descriptor = actions
    .operation('query', 'year', 'Read year')
    .params(z.iso.datetime().transform((value) => new Date(value)))
    .handle((date) => date.getUTCFullYear());
  assert.equal(descriptor.parameters?.type, 'string');
  assert.equal(descriptor.parameters?.format, 'date-time');
  assert.deepEqual(
    await executeVacpAction(
      actions.registry,
      {
        callId: 'year',
        name: descriptor.name,
        params: '2026-09-19T00:00:00Z',
      },
      context,
    ),
    { callId: 'year', ok: true, result: 2026 },
  );
});
