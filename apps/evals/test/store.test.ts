import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { appendJsonl, holdLock, readJsonl, repairTail } from '../src/results/store';

const scratch = () => mkdtempSync(join(tmpdir(), 'vacp-evals-store-'));

test('a row torn by a crash mid-append is left out, and a repaired file takes rows on clean lines', () => {
  const file = join(scratch(), 'results.jsonl');
  appendJsonl(file, { scenario: 'a', rep: 0 });
  appendFileSync(file, '{"scenario":"b","re');
  assert.deepEqual(readJsonl(file), [{ scenario: 'a', rep: 0 }]);
  repairTail(file);
  appendJsonl(file, { scenario: 'c', rep: 0 });
  assert.equal(readFileSync(file, 'utf8'), '{"scenario":"a","rep":0}\n{"scenario":"c","rep":0}\n');
});

test('a held variant refuses a second holder until it is released', () => {
  const lock = join(scratch(), 'variant=v1', '.lock');
  const release = holdLock(lock, 'cars / v1');
  assert.throws(() => holdLock(lock, 'cars / v1'), new RegExp(`cars / v1 is in use by process ${process.pid}`));
  release();
  assert.equal(existsSync(lock), false);
  holdLock(lock, 'cars / v1')();
});

test('a lock left by an exited process passes to the next holder', () => {
  const lock = join(scratch(), '.lock');
  const exited = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  writeFileSync(lock, exited.stdout);
  const release = holdLock(lock, 'cars / v1');
  assert.equal(readFileSync(lock, 'utf8'), String(process.pid));
  release();
});
