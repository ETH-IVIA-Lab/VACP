import http from 'node:http';
import process from 'node:process';
import httpProxy from 'http-proxy';

function parsePort(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

const host = process.env.VACP_EXAMPLES_HOST ?? '127.0.0.1';
const hubPort = parsePort(process.env.VACP_EXAMPLES_HUB_PORT, 5173);
const basePort = parsePort(process.env.VACP_EXAMPLES_BASE_PORT, 5174);

const examples = [
  { route: 'mosaic', title: 'mosaic-gallery', port: basePort + 0 },
  { route: 'vega-lite', title: 'vega-lite-gallery', port: basePort + 1 },
  { route: 'd3-lasso', title: 'd3-scatter-lasso', port: basePort + 2 },
  { route: 'vanilla', title: 'vanilla-minimal', port: basePort + 3 },
  { route: 'react-dashboard', title: 'react-dashboard', port: basePort + 4 },
];

const routeToTarget = new Map(
  examples.map((x) => [
    x.route,
    {
      targetOrigin: `http://${host}:${x.port}`,
    },
  ]),
);

const proxy = httpProxy.createProxyServer({
  xfwd: true,
  ws: true,
});

proxy.on('error', (err, _req, resOrSocket) => {
  if (!resOrSocket) return;
  if (typeof resOrSocket.writeHead === 'function') {
    resOrSocket.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    resOrSocket.end(`examples-hub proxy error: ${err?.message ?? String(err)}\n`);
    return;
  }
  try {
    resOrSocket.destroy();
  } catch {
  }
});

function indexHtml() {
  const rows = examples
    .map((x) => {
      const href = `/${x.route}/`;
      return `<li><a href="${href}">${x.route}</a> <span style="color:#666">(${x.title})</span></li>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>VACP Examples Hub</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin: 24px; }
      code { background: #f4f4f5; padding: 0 6px; border-radius: 6px; }
      a { color: #2563eb; text-decoration: none; }
      a:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <h1>VACP Examples Hub</h1>
    <p>Routes (query params preserved):</p>
    <ul>
      ${rows}
    </ul>
    <p>Example dev ports start at <code>${basePort}</code>. Hub runs at <code>${hubPort}</code>.</p>
  </body>
</html>`;
}

function findRoute(pathname) {
  const m = /^\/([^/]+)(\/|$)/.exec(pathname);
  if (!m) return null;
  return m[1] ?? null;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${hubPort}`}`);
  const { pathname } = url;

  if (pathname === '/' || pathname === '') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(indexHtml());
    return;
  }

  const route = findRoute(pathname);
  const target = route ? routeToTarget.get(route) : undefined;
  if (!target) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Unknown example route. Available: ${examples.map((x) => x.route).join(', ')}\n`);
    return;
  }

  if (pathname === `/${route}`) {
    url.pathname = `/${route}/`;
    res.writeHead(302, { location: url.toString() });
    res.end();
    return;
  }

  proxy.web(req, res, { target: target.targetOrigin });
});

server.on('upgrade', (req, socket, head) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${hubPort}`}`);
    const route = findRoute(url.pathname);
    const target = route ? routeToTarget.get(route) : undefined;
    if (!target) {
      socket.destroy();
      return;
    }
    proxy.ws(req, socket, head, { target: target.targetOrigin });
  } catch {
    socket.destroy();
  }
});

server.listen(hubPort, host, () => {
  console.log(`[examples-hub] listening on http://${host}:${hubPort}/`);
  for (const ex of examples) {
    console.log(`[examples-hub] /${ex.route}/ -> http://${host}:${ex.port}/${ex.route}/`);
  }
});
