import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

function parsePort(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeBasePath(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '/';
  let base = raw;
  if (!base.startsWith('/')) base = `/${base}`;
  if (!base.endsWith('/')) base = `${base}/`;
  return base;
}

function prefixPipe(name, stream, out) {
  if (!stream) return;
  let buf = '';
  stream.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    while (true) {
      const idx = buf.indexOf('\n');
      if (idx === -1) break;
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      out.write(`[${name}] ${line}\n`);
    }
  });
  stream.on('end', () => {
    if (buf) out.write(`[${name}] ${buf}\n`);
  });
}

function spawnNamed(name, cmd, args, opts) {
  const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
  prefixPipe(name, child.stdout, process.stdout);
  prefixPipe(name, child.stderr, process.stderr);
  return child;
}

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, '..');
const examplesDir = resolve(repoRoot, 'packages', 'examples');

const host = process.env.VACP_EXAMPLES_HOST ?? '127.0.0.1';
const hubPort = parsePort(process.env.VACP_EXAMPLES_HUB_PORT, 5173);
const basePort = parsePort(process.env.VACP_EXAMPLES_BASE_PORT, 5174);

const examples = [
  { route: 'mosaic', dir: resolve(examplesDir, 'mosaic-gallery'), port: basePort + 0 },
  { route: 'vega-lite', dir: resolve(examplesDir, 'vega-lite-gallery'), port: basePort + 1 },
  { route: 'd3-lasso', dir: resolve(examplesDir, 'd3-scatter-lasso'), port: basePort + 2 },
  { route: 'vanilla', dir: resolve(examplesDir, 'vanilla-minimal'), port: basePort + 3 },
  { route: 'react-dashboard', dir: resolve(examplesDir, 'react-dashboard'), port: basePort + 4 },
];

const children = [];

function ansi(style) {
  if (!process.stdout.isTTY) return '';
  const map = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    underline: '\x1b[4m',
    gray: '\x1b[90m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
  };
  return map[style] ?? '';
}

function padRight(s, n) {
  const str = String(s);
  if (str.length >= n) return str;
  return str + ' '.repeat(n - str.length);
}

function printBanner() {
  const title = `${ansi('bold')}VACP Examples Hub${ansi('reset')}`;
  const url = `${ansi('underline')}${ansi('cyan')}http://${host}:${hubPort}/${ansi('reset')}`;
  const hint = `${ansi('dim')}Open this URL in your browser.${ansi('reset')}`;
  const stop = `${ansi('dim')}Stop: Ctrl+C${ansi('reset')}`;

  const lines = [
    `${title}`,
    '',
    `Visit: ${url}`,
    `${hint}`,
    '',
    `${ansi('bold')}Routes${ansi('reset')}:`,
    ...examples.map(
      (x) => `  ${ansi('blue')}/${x.route}/${ansi('reset')}  ${ansi('gray')}(port ${x.port})${ansi('reset')}`,
    ),
    '',
    `${stop}`,
  ];

  const contentWidth = Math.max(...lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').length));
  const top = `╭${'─'.repeat(contentWidth + 2)}╮`;
  const bot = `╰${'─'.repeat(contentWidth + 2)}╯`;
  const body = lines
    .map((l) => {
      const visibleLen = l.replace(/\x1b\[[0-9;]*m/g, '').length;
      return `│ ${l}${' '.repeat(contentWidth - visibleLen)} │`;
    })
    .join('\n');

  process.stdout.write(`\n${top}\n${body}\n${bot}\n\n`);
}

function shutdown(code = 0) {
  for (const c of children) {
    if (!c || c.exitCode !== null) continue;
    try {
      c.kill('SIGTERM');
    } catch {}
  }
  setTimeout(() => {
    for (const c of children) {
      if (!c || c.exitCode !== null) continue;
      try {
        c.kill('SIGKILL');
      } catch {}
    }
    process.exit(code);
  }, 7_000).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

children.push(
  spawnNamed('hub', 'node', [resolve(repoRoot, 'scripts', 'examples-hub-proxy.mjs')], {
    cwd: repoRoot,
    env: {
      ...process.env,
      VACP_EXAMPLES_HOST: host,
      VACP_EXAMPLES_HUB_PORT: String(hubPort),
      VACP_EXAMPLES_BASE_PORT: String(basePort),
    },
  }),
);

children.push(
  spawnNamed('debug-ui', 'pnpm', ['--filter', '@vacp/debug-ui', 'dev'], {
    cwd: repoRoot,
    env: { ...process.env, BROWSER: 'none' },
  }),
);

for (const ex of examples) {
  const base = normalizeBasePath(`/${ex.route}/`);
  children.push(
    spawnNamed(ex.route, 'pnpm', ['dev', '--host', host, '--port', String(ex.port), '--strictPort'], {
      cwd: ex.dir,
      env: {
        ...process.env,
        BROWSER: 'none',
        VACP_BASE_PATH: base,
        VACP_VITE_CACHE_DIR: `node_modules/.vite-hub-${ex.route}-${ex.port}`,
      },
    }),
  );
}

for (const c of children) {
  c.on('exit', (code, signal) => {
    const ok = code === 0 || code === null;
    if (ok && signal !== null) return;
    if (!ok) shutdown(code ?? 1);
  });
}

printBanner();
