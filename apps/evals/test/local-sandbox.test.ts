import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
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

/** A sandbox root under the temp directory, removed with any server a failed test left running. */
function scratch(t: TestContext) {
  const root = join(tmpdir(), `vacp-evals-${randomUUID()}`);
  const servers: number[] = [];
  t.after(() => {
    for (const server of servers) if (alive(server)) process.kill(server, 'SIGKILL');
    rmSync(root, { recursive: true, force: true });
  });
  return { root, servers };
}

test('destroying a sandbox ends the servers its commands left running in the background', async (t) => {
  const { root, servers } = scratch(t);
  const sandbox = await LocalSandbox.create(root);
  // A runtime's bootstrap starts its server this way: the shell returns while the server keeps running.
  const { stdout } = await sandbox.run({ command: 'sleep 300 > /dev/null 2>&1 & echo $!' });
  const server = Number(stdout.trim());
  servers.push(server);
  assert.equal(alive(server), true);
  await sandbox.destroy();
  for (let attempt = 0; attempt < 50 && alive(server); attempt++) await sleep(20);
  assert.equal(alive(server), false);
});

test('an eval that exits before destroying its sandbox ends the servers the sandbox started', async (t) => {
  const { root, servers } = scratch(t);
  const script = `
    import { LocalSandbox } from ${JSON.stringify(join(import.meta.dirname, '../src/conditions/local-sandbox.ts'))};
    const sandbox = await LocalSandbox.create(${JSON.stringify(root)});
    const { stdout } = await sandbox.run({ command: 'sleep 300 > /dev/null 2>&1 & echo $!' });
    process.stdout.write(stdout.trim());
    process.exit(1);
  `;
  let stdout = '';
  try {
    execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8' });
  } catch (error) {
    stdout = (error as { stdout: string }).stdout;
  }
  const server = Number(stdout);
  assert.ok(server > 0);
  servers.push(server);
  for (let attempt = 0; attempt < 50 && alive(server); attempt++) await sleep(20);
  assert.equal(alive(server), false);
});
