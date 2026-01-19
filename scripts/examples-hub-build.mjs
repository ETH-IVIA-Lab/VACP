import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

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

function waitForExit(child, name) {
  return new Promise((resolvePromise, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) return resolvePromise();
      const suffix = signal ? ` (signal ${signal})` : '';
      reject(new Error(`${name} exited with code ${code ?? 'null'}${suffix}`));
    });
  });
}

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, '..');
const examplesDir = resolve(repoRoot, 'packages', 'examples');

const examples = [
  { route: 'mosaic', name: 'vacp-example-mosaic-gallery', dir: resolve(examplesDir, 'mosaic-gallery') },
  { route: 'vega-lite', name: 'vacp-example-vega-lite-gallery', dir: resolve(examplesDir, 'vega-lite-gallery') },
  { route: 'd3-lasso', name: 'vacp-example-d3-scatter-lasso', dir: resolve(examplesDir, 'd3-scatter-lasso') },
  { route: 'vanilla', name: 'vacp-example-vanilla-minimal', dir: resolve(examplesDir, 'vanilla-minimal') },
  { route: 'react-dashboard', name: 'vacp-example-react-dashboard', dir: resolve(examplesDir, 'react-dashboard') },
  { route: 'cars-parcoords', name: 'vacp-example-cars-parallel-coords', dir: resolve(examplesDir, 'cars-parallel-coords') },
];

// Build workspace libs required by examples (exports -> dist/) before building apps.
await waitForExit(
  spawnNamed('libs', 'pnpm', ['-r', '--filter', '@vacp/*', 'build'], { cwd: repoRoot, env: { ...process.env } }),
  'libs',
);

for (const ex of examples) {
  const base = normalizeBasePath(`/${ex.route}/`);
  await waitForExit(
    spawnNamed(ex.route, 'pnpm', ['build'], {
      cwd: ex.dir,
      env: {
        ...process.env,
        VACP_BASE_PATH: base,
      },
    }),
    ex.route,
  );
}
