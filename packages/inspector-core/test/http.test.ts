import assert from 'node:assert/strict';
import test from 'node:test';
import { connectHttpInspectorClient } from '../src/http';
import { parseObservation } from '@vacp/protocol/validation';
import { observation } from './fixtures';

test('HTTP connects by server identity and carries cancellation, custom fetch, and typed payloads', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = await connectHttpInspectorClient({
    url: 'https://analysis.example/api/vacp/',
    intervalMs: 0,
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith('/session')) return Response.json({ id: 'owner', title: 'Analysis' });
      assert.equal(new Headers(init?.headers).get('X-VACP-Session'), 'owner');
      if (String(url).endsWith('/observation')) return Response.json(observation());
      return Response.json({ callId: 'call', ok: true, result: { custom: [1, 2] } });
    },
  });
  const signal = new AbortController().signal;
  assert.equal((await client.observe({ signal })).revision, '0');
  assert.deepEqual(await client.execute!({ callId: 'call', name: 'set', params: { custom: true } }, { signal }), {
    callId: 'call',
    ok: true,
    result: { custom: [1, 2] },
  });
  assert.equal(requests[1].init?.signal, signal);
  assert.equal(requests[2].init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(requests[2].init?.body)), {
    callId: 'call',
    name: 'set',
    params: { custom: true },
  });
});

test('HTTP rejects stale sessions and mismatched operation results', async () => {
  let stale = true;
  const client = await connectHttpInspectorClient({
    url: 'https://analysis.example/api/vacp',
    fetch: async (url) =>
      String(url).endsWith('/session')
        ? Response.json({ id: 'owner', title: 'Analysis' })
        : stale
          ? new Response('Session changed', { status: 409 })
          : Response.json({ callId: 'wrong', ok: true }),
  });
  const signal = new AbortController().signal;
  await assert.rejects(client.observe({ signal }), /409/);
  stale = false;
  await assert.rejects(client.execute!({ callId: 'call', name: 'set' }, { signal }), /callId/);
});

test('wire validation retains custom entity metadata and rejects incomplete observations', () => {
  const value = observation();
  value.graph.actions[0].operation.contract = 'custom.domain.inspect';
  value.graph.nodes[0].data = { nested: { domain: [1, 2] } };
  assert.deepEqual(parseObservation(value), value);
  const invalid = structuredClone(value);
  Object.assign(invalid.graph.actions[0].operation, { contract: 42 });
  assert.throws(() => parseObservation(invalid));
  assert.throws(() => parseObservation({ revision: '1', graph: {} }));
});

test('HTTP polling pauses during reads and releases its timer with the last subscriber', async (context) => {
  context.mock.timers.enable({ apis: ['setInterval'] });
  let finish!: (response: Response) => void;
  const response = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const client = await connectHttpInspectorClient({
    url: 'https://analysis.example/api/vacp',
    intervalMs: 1000,
    fetch: async (url) =>
      String(url).endsWith('/session') ? Response.json({ id: 'owner', title: 'Analysis' }) : response,
  });
  let notifications = 0;
  const listener = () => {
    notifications++;
  };
  const failing = client.subscribe!(() => {
    throw new Error('Renderer failed');
  });
  const first = client.subscribe!(listener);
  const second = client.subscribe!(listener);
  context.mock.timers.tick(1000);
  assert.equal(notifications, 2);
  const read = client.observe({ signal: new AbortController().signal });
  context.mock.timers.tick(2000);
  assert.equal(notifications, 2);
  finish(Response.json(observation()));
  await read;
  first();
  first();
  context.mock.timers.tick(1000);
  assert.equal(notifications, 3);
  second();
  failing();
  context.mock.timers.tick(5000);
  assert.equal(notifications, 3);
});
