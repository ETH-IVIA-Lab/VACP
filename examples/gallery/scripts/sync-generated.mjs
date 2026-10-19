import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import fs from 'node:fs';
import { escapeHtml } from '@ethivia/vacp-example-shared/html';
import { examples } from '../examples.manifest.ts';

const scriptDir = dirname(fileURLToPath(import.meta.url));

const galleryDir = resolve(scriptDir, '..');

const generatedMarker = '.vacp-gallery-generated';

await main();

async function main() {
  const entries = examples;
  validateEntries(entries);
  syncRoutePages(entries);
  syncPublicAssets(entries);
}

function validateEntries(entries) {
  const seenRoutes = new Set();
  const seenIds = new Set();

  for (const entry of entries) {
    if (!/^[a-z0-9-]+$/.test(entry.route)) throw new Error(`Invalid route "${entry.route}"`);

    if (seenRoutes.has(entry.route)) throw new Error(`Duplicate route "${entry.route}"`);

    if (seenIds.has(entry.id)) throw new Error(`Duplicate id "${entry.id}"`);
    seenRoutes.add(entry.route);
    seenIds.add(entry.id);
  }
}

function syncRoutePages(entries) {
  const activeRoutes = new Set(entries.map((entry) => entry.route));

  // Remove stale generated route directories.
  for (const name of fs.readdirSync(galleryDir, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const routeDir = resolve(galleryDir, name.name);
    const markerPath = resolve(routeDir, generatedMarker);

    if (!fs.existsSync(markerPath)) continue;

    if (activeRoutes.has(name.name)) continue;
    fs.rmSync(routeDir, { recursive: true, force: true });
  }

  for (const entry of entries) {
    const routeDir = resolve(galleryDir, entry.route);
    fs.mkdirSync(routeDir, { recursive: true });
    writeIfChanged(resolve(routeDir, generatedMarker), `${entry.id}\n`);
    writeIfChanged(resolve(routeDir, 'index.html'), renderRouteHtml({ title: entry.title, route: entry.route }));
  }
}

/** Running dev servers reload on every write, so unchanged output is left untouched. */
function writeIfChanged(path, content) {
  const next = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  if (fs.existsSync(path) && fs.readFileSync(path).equals(next)) return;
  fs.writeFileSync(path, next);
}

function syncPublicAssets(entries) {
  const outDir = resolve(galleryDir, '.generated-public');
  const sources = new Map();
  for (const entry of entries) {
    const srcDir = resolve(galleryDir, '..', entry.folder, 'public');
    if (fs.existsSync(srcDir)) sources.set(entry.route, srcDir);
  }
  mirrorDir(outDir, sources);
}

/** Make `dst` hold exactly the named sources, copying only files whose bytes differ. */
function mirrorDir(dst, sources) {
  fs.mkdirSync(dst, { recursive: true });
  for (const item of fs.readdirSync(dst, { withFileTypes: true }))
    if (!sources.has(item.name)) fs.rmSync(resolve(dst, item.name), { recursive: true, force: true });

  for (const [name, srcPath] of sources) {
    const dstPath = resolve(dst, name);
    if (fs.statSync(srcPath).isDirectory()) {
      if (fs.existsSync(dstPath) && !fs.statSync(dstPath).isDirectory()) fs.rmSync(dstPath, { force: true });
      const children = new Map(fs.readdirSync(srcPath).map((child) => [child, resolve(srcPath, child)]));
      mirrorDir(dstPath, children);
    } else {
      if (fs.existsSync(dstPath) && fs.statSync(dstPath).isDirectory()) fs.rmSync(dstPath, { recursive: true });
      writeIfChanged(dstPath, fs.readFileSync(srcPath));
    }
  }
}

function renderRouteHtml(args) {
  const escapedTitle = escapeHtml(args.title);
  const escapedRoute = escapeHtml(args.route);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapedTitle}</title>
    <link rel="icon" href="data:," />
  </head>
  <body data-vacp-gallery-route="${escapedRoute}">
    <div id="gallery-example-root"></div>
    <script type="module" src="../src/route-entry.ts"></script>
  </body>
</html>
`;
}
