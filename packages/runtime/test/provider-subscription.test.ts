import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { createProviderSubscription } from '../src/index';

test('provider subscribers share a binding and isolate callbacks across reattachment', async () => {
  let notify = () => {};
  let attached = 0;
  let detached = 0;
  const subscription = createProviderSubscription(
    (invalidate) => {
      attached++;
      notify = invalidate;
      return () => {
        detached++;
      };
    },
    { quietMs: 5 },
  );
  let observed = 0;
  const first = subscription.subscribe(() => {
    throw new Error('consumer failed');
  });
  const second = subscription.subscribe(() => {
    observed++;
  });
  assert.equal(attached, 1);
  notify();
  notify();
  await setTimeout(20);
  assert.equal(observed, 1);
  first();
  assert.equal(detached, 0);
  notify();
  second();
  await setTimeout(20);
  assert.equal(observed, 1);
  assert.equal(detached, 1);
  const third = subscription.subscribe(() => {
    observed++;
  });
  assert.equal(attached, 2);
  notify();
  subscription.dispose();
  await setTimeout(20);
  assert.equal(observed, 1);
  assert.equal(detached, 2);
  third();
  assert.equal(detached, 2);
  assert.throws(() => subscription.subscribe(() => {}), /disposed/);
});

test('a failed provider binding leaves the subscription available for retry', () => {
  let attempts = 0;
  let detached = 0;
  const subscription = createProviderSubscription(
    () => {
      if (++attempts === 1) throw new Error('binding failed');
      return () => {
        detached++;
      };
    },
    { quietMs: 5 },
  );
  assert.throws(() => subscription.subscribe(() => {}), /binding failed/);
  const detach = subscription.subscribe(() => {});
  detach();
  assert.equal(attempts, 2);
  assert.equal(detached, 1);
});
