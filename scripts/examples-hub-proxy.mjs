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
      return `
        <a class="card" href="${href}">
          <div class="card-left">
            <div class="route">/${x.route}/</div>
            <div class="subtitle">${x.title}</div>
          </div>
          <div class="pill">open</div>
        </a>
      `;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>VACP Examples Hub</title>
    <style>
      :root {
        --bg: #f5f5f7;
        --card: rgba(255, 255, 255, 0.76);
        --border: rgba(0, 0, 0, 0.08);
        --text: rgba(0, 0, 0, 0.92);
        --muted: rgba(0, 0, 0, 0.56);
        --shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
      }

      html, body { height: 100%; }
      body {
        margin: 0;
        color: var(--text);
        background: radial-gradient(1200px 600px at 20% -10%, rgba(0, 122, 255, 0.12), transparent 55%),
          radial-gradient(1200px 600px at 80% 0%, rgba(88, 86, 214, 0.10), transparent 55%),
          var(--bg);
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }

      .wrap { max-width: 860px; margin: 0 auto; padding: 44px 22px 64px; }

      .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
      .title { margin: 0; font-weight: 650; letter-spacing: -0.02em; font-size: 28px; }
      .sub { margin: 10px 0 0; color: var(--muted); line-height: 1.45; }

      .meta {
        text-align: right;
        color: var(--muted);
        font-size: 13px;
        margin-top: 6px;
        line-height: 1.4;
      }
      code {
        background: rgba(0, 0, 0, 0.045);
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 12.5px;
      }

      .grid {
        margin-top: 22px;
        padding: 18px;
        border: 1px solid var(--border);
        border-radius: 18px;
        background: var(--card);
        box-shadow: var(--shadow);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
      }

      .cards { display: grid; grid-template-columns: 1fr; gap: 12px; }
      @media (min-width: 720px) { .cards { grid-template-columns: 1fr 1fr; } }

      .card {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 14px;
        padding: 14px 14px 14px 16px;
        border: 1px solid rgba(0,0,0,0.07);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.82);
        text-decoration: none;
        transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
      }
      .card:hover {
        transform: translateY(-1px);
        border-color: rgba(0,0,0,0.11);
        box-shadow: 0 8px 22px rgba(0, 0, 0, 0.10);
      }
      .card:active { transform: translateY(0); }
      .card:focus-visible { outline: 3px solid rgba(0, 122, 255, 0.35); outline-offset: 2px; }

      .route { font-weight: 640; letter-spacing: -0.01em; color: var(--text); }
      .subtitle { margin-top: 4px; font-size: 13px; color: var(--muted); }
      .pill {
        flex: 0 0 auto;
        font-size: 12px;
        color: rgba(0, 0, 0, 0.66);
        background: rgba(0, 0, 0, 0.05);
        border: 1px solid rgba(0,0,0,0.06);
        padding: 6px 10px;
        border-radius: 999px;
      }

      .footer {
        margin-top: 16px;
        color: var(--muted);
        font-size: 13px;
        display: flex;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
      }
      .footer a { color: rgba(0, 0, 0, 0.74); text-decoration: none; border-bottom: 1px solid rgba(0,0,0,0.14); }
      .footer a:hover { border-bottom-color: rgba(0,0,0,0.28); }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="header">
        <div>
          <h1 class="title">VACP Examples Hub</h1>
          <p class="sub">
            One base URL for all example apps. Routes preserve query params (e.g. <code>?vacp-debug=1</code>).
          </p>
        </div>
        <div class="meta">
          <div>Hub: <code>${host}:${hubPort}</code></div>
          <div>Examples: <code>${host}:${basePort}+i</code></div>
        </div>
      </div>

      <div class="grid">
        <div class="cards">
          ${rows}
        </div>

        <div class="footer">
          <div>Tip: append <code>?vacp-debug=1</code> to enable the overlay.</div>
          <div>Unknown route returns <code>404</code>.</div>
        </div>
      </div>
    </div>
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
