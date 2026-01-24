import { run } from './app';

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  document.body.textContent = String(err);
});
