import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  resolveVacpAvailability,
  resolveVacpObservation,
  assertVacpActionAvailable,
  VacpAvailabilityError,
} from '../src/availability';
import {
  VACP_SCHEMA_VERSION,
  type VacpAvailability,
  type VacpRef,
  type VacpObservation,
  type VacpActionDescriptor,
  type VacpActionCall,
} from '../src/schema';

type Case = {
  name: string;
  nodes: Array<{ ref: VacpRef; availability?: VacpAvailability }>;
  actions: Array<
    Pick<VacpActionDescriptor, 'name' | 'availability'> & { operation?: VacpActionDescriptor['operation'] }
  >;
  statuses?: unknown;
  calls?: Array<Omit<VacpActionCall, 'callId'> & { error?: unknown }>;
  error?: string;
};
const cases: Case[] = JSON.parse(readFileSync(new URL('./fixtures/availability.json', import.meta.url), 'utf8'));
for (const example of cases)
  test(example.name, () => {
    if (example.error) {
      assert.throws(() => resolveVacpAvailability(example), { message: example.error });
      return;
    }
    const resolved = resolveVacpObservation({
      version: VACP_SCHEMA_VERSION,
      revision: '1',
      observedAt: '',
      state: {},
      graph: {
        version: VACP_SCHEMA_VERSION,
        sources: [],
        ownership: { nodes: {}, actions: {} },
        edges: [],
        nodes: example.nodes.map((node) => ({ ...node, kind: 'View', layer: 'ViewLayer' })),
        actions: example.actions.map((action) => ({
          ...action,
          description: action.name,
          operation: action.operation ?? { kind: 'mutation' },
        })),
      },
    });
    const status = resolved.availability;
    // Exercise the serialized representation shared with Python and remote consumers.
    assert.deepEqual(
      JSON.parse(
        JSON.stringify({
          nodes: Object.fromEntries(status.nodes),
          actions: Object.fromEntries(status.actions),
        }),
      ),
      example.statuses,
    );
    for (const invocation of example.calls ?? []) {
      const call = { callId: 'fixture', name: invocation.name, params: invocation.params };
      if (invocation.error) {
        assert.throws(
          () => assertVacpActionAvailable(resolved, call),
          (error) => {
            assert.ok(error instanceof VacpAvailabilityError);
            assert.deepEqual(JSON.parse(JSON.stringify(error.details)), invocation.error);
            return true;
          },
        );
      } else assertVacpActionAvailable(resolved, call);
    }
  });

test('disclosure filters state, edges, freshness and ownership without mutating the inspection catalog', () => {
  const observation: VacpObservation = {
    version: VACP_SCHEMA_VERSION,
    revision: '1',
    observedAt: '',
    graph: {
      version: VACP_SCHEMA_VERSION,
      sources: [],
      ownership: {
        nodes: { 'vacp://data': 'vacp-source://data', 'vacp://menu': 'vacp-source://menu' },
        actions: { load: 'vacp-source://data', query: 'vacp-source://data' },
      },
      nodes: [
        { ref: 'vacp://data', kind: 'DataHandle', layer: 'DataLayer', availability: { unavailable: 'Choose data' } },
        { ref: 'vacp://menu', kind: 'Widget', layer: 'ViewLayer' },
      ],
      edges: [{ from: 'vacp://data', to: 'vacp://menu', kind: 'contains' }],
      actions: [
        { name: 'load', description: 'Load', operation: { kind: 'creation', affects: ['vacp://data'] } },
        {
          name: 'query',
          description: 'Query',
          operation: { kind: 'query' },
          availability: { requires: ['vacp://data'] },
        },
      ],
    },
    state: { 'vacp://data': [1, 2], 'vacp://menu': 'Choose' },
    summary: { 'vacp://data': 2 },
    freshness: { 'vacp://data': { status: 'current' } },
  };
  const before = structuredClone(observation);
  const resolved = resolveVacpObservation(observation);
  const disclosed = resolved.observation;
  assert.deepEqual(
    disclosed.graph.nodes.map((node) => node.ref),
    ['vacp://menu'],
  );
  assert.deepEqual(
    disclosed.graph.actions.map((action) => action.name),
    ['load'],
  );
  assert.deepEqual(disclosed.graph.edges, []);
  assert.deepEqual(disclosed.graph.ownership, {
    nodes: { 'vacp://menu': 'vacp-source://menu' },
    actions: { load: 'vacp-source://data' },
  });
  assert.deepEqual(disclosed.state, { 'vacp://menu': 'Choose' });
  assert.deepEqual(disclosed.summary, {});
  assert.deepEqual(disclosed.freshness, {});
  assert.deepEqual(observation, before);
  // Acquisition may affect an entity that does not exist in the disclosed view yet.
  assertVacpActionAvailable(resolved, { callId: 'acquire', name: 'load' });
});
