import assert from 'node:assert/strict';
import test from 'node:test';
import { abortable } from '../src/index';

test('aborting before the deferred operation prevents it from starting', async () => {
  const controller = new AbortController();
  let entered = false;
  const pending = abortable(controller.signal, () => {
    entered = true;
  });
  controller.abort(new Error('Stopped'));
  await assert.rejects(pending, /Stopped/);
  assert.equal(entered, false);
});

test('cancellation releases a request whose operation ignores its signal', async () => {
  const controller = new AbortController();
  let finish!: (value: number) => void;
  const pending = abortable(
    controller.signal,
    () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
  );
  await Promise.resolve();
  controller.abort(new Error('Stopped'));
  await assert.rejects(pending, /Stopped/);
  finish(42);
});

test('abortable preserves operation results and failures', async () => {
  const signal = new AbortController().signal;
  assert.equal(await abortable(signal, () => 42), 42);
  await assert.rejects(
    abortable(signal, () => {
      throw new Error('Unavailable');
    }),
    /Unavailable/,
  );
});
