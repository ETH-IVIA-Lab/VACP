import { mount } from './mfe';

const root = document.getElementById('vacp-example-root');
if (!root) throw new Error('Missing #vacp-example-root');

mount(root).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  root.innerHTML = `<pre style="color:#991b1b;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px;white-space:pre-wrap">${String(err)}</pre>`;
});
