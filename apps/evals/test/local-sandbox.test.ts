import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { LocalSandbox } from '../src/conditions/local-sandbox';

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test('destroying a sandbox ends the servers its commands left running in the background', async () => {
  const sandbox = await LocalSandbox.create(join(tmpdir(), `vacp-evals-${randomUUID()}`));
  // A runtime's bootstrap starts its server this way: the shell returns while the server keeps running.
  const { stdout } = await sandbox.run({ command: 'sleep 300 > /dev/null 2>&1 & echo $!' });
  const server = Number(stdout.trim());
  assert.equal(alive(server), true);
  await sandbox.destroy();
  for (let attempt = 0; attempt < 50 && alive(server); attempt++) await sleep(20);
  assert.equal(alive(server), false);
});
