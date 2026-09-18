import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { getEventListeners } from 'node:events';
import test from 'node:test';
import { promisify } from 'node:util';
import { sleep, sleepUnref } from '../src/runner/util.ts';

for (const wait of [sleep, sleepUnref]) {
  test(`${wait.name} releases abort listeners after completion and cancellation`, async () => {
    // Keep the event loop alive while exercising an unreferenced timer.
    const keepAlive = setInterval(() => {}, 1_000);
    const controller = new AbortController();
    try {
      await wait(0, controller.signal);
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0);

      const pending = wait(60_000, controller.signal);
      assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
      controller.abort();
      await pending;
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0);

      await wait(60_000, controller.signal);
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    } finally {
      controller.abort();
      clearInterval(keepAlive);
    }
  });
}

test('only a referenced sleep keeps an otherwise idle process alive', async () => {
  const moduleUrl = new URL('../src/runner/util.ts', import.meta.url).href;
  const exec = promisify(execFile);
  for (const [name, delay, expected] of [
    ['sleep', 100, 'elapsed'],
    ['sleepUnref', 60_000, ''],
  ] as const) {
    const script = `import { ${name} } from ${JSON.stringify(moduleUrl)};
      ${name}(${delay}).then(() => process.stdout.write('elapsed'));`;
    const { stdout } = await exec(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
      timeout: 10_000,
    });
    assert.equal(stdout, expected, name);
  }
});
