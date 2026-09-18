import { expect, test } from '@playwright/test';
import { startAppServer } from '../helpers/devserver';
import { exampleDir } from '../helpers/paths';

test('stopping an application server closes its listening port', async () => {
  const server = await startAppServer({ name: 'lifecycle', cwd: exampleDir('cars-parallel-coords') });

  try {
    expect((await fetch(server.url)).ok).toBe(true);
  } finally {
    await server.stop();
  }

  await expect
    .poll(async () => {
      try {
        await fetch(server.url, { signal: AbortSignal.timeout(1_000) });

        return true;
      } catch {
        return false;
      }
    })
    .toBe(false);
  await server.stop();
});
