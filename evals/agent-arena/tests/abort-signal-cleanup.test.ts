import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { sleep, sleepUnref } from '../src/runner/util.ts';

async function main() {
  await testSleepDoesNotAccumulateAbortListeners();
  await testSleepUnrefDoesNotAccumulateAbortListeners();
  await testSleepCleansUpListenerOnAbort();
  await testSleepUnrefCleansUpListenerOnAbort();
  await testSleepWithAlreadyAbortedSignal();
  await testSleepUnrefWithAlreadyAbortedSignal();
  await testSleepTimerRefSemantics();
  console.log('abort-signal-cleanup: ok');
}

async function testSleepDoesNotAccumulateAbortListeners() {
  const controller = new AbortController();

  for (let i = 0; i < 100; i++) {
    await Promise.all([sleep(1, controller.signal), refDelay(1)]);
  }

  assert.equal(listenerCount(controller.signal), 0);
}

async function testSleepUnrefDoesNotAccumulateAbortListeners() {
  const controller = new AbortController();

  for (let i = 0; i < 100; i++) {
    await Promise.all([sleepUnref(1, controller.signal), refDelay(1)]);
  }

  assert.equal(listenerCount(controller.signal), 0);
}

async function testSleepCleansUpListenerOnAbort() {
  const controller = new AbortController();
  const pending = sleep(60_000, controller.signal);
  assert.equal(listenerCount(controller.signal), 1);
  controller.abort();
  await pending;
  assert.equal(listenerCount(controller.signal), 0);
}

async function testSleepUnrefCleansUpListenerOnAbort() {
  const controller = new AbortController();
  const pending = sleepUnref(60_000, controller.signal);
  assert.equal(listenerCount(controller.signal), 1);
  controller.abort();
  await pending;
  assert.equal(listenerCount(controller.signal), 0);
}

async function testSleepWithAlreadyAbortedSignal() {
  const controller = new AbortController();
  controller.abort();
  await sleep(10, controller.signal);
  assert.equal(listenerCount(controller.signal), 0);
}

async function testSleepUnrefWithAlreadyAbortedSignal() {
  const controller = new AbortController();
  controller.abort();
  await sleepUnref(10, controller.signal);
  assert.equal(listenerCount(controller.signal), 0);
}

async function testSleepTimerRefSemantics() {
  const originalSetTimeout = globalThis.setTimeout;
  const records: Array<{ unrefCount: number }> = [];

  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const timer = originalSetTimeout(handler, timeout, ...args);
    const timerAny = timer;
    const record = { unrefCount: 0 };
    records.push(record);

    const originalUnref = typeof timerAny.unref === 'function' ? timerAny.unref.bind(timerAny) : undefined;
    timerAny.unref = () => {
      record.unrefCount += 1;

      return originalUnref ? originalUnref() : timerAny;
    };

    return timer;
  }) as typeof setTimeout;

  try {
    records.length = 0;
    await Promise.all([sleep(1), refDelay(1)]);
    assert.ok(records.length > 0);
    assert.equal(records[0]?.unrefCount ?? 0, 0);

    records.length = 0;
    await Promise.all([sleepUnref(1), refDelay(1)]);
    assert.ok(records.length > 0);
    assert.ok((records[0]?.unrefCount ?? 0) >= 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
}

function listenerCount(signal: AbortSignal) {
  return getEventListeners(signal, 'abort').length;
}

function refDelay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

void main();
