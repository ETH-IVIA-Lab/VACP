import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import fs from 'node:fs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const galleryDir = resolve(scriptDir, '..');
const manifestPath = resolve(galleryDir, 'examples.manifest.json');
const generatedMarker = '.vacp-gallery-generated';

await main();

async function main() {
  const entries = readManifest();
  validateEntries(entries);
  syncRoutePages(entries);
  syncPublicAssets(entries);
}

function readManifest() {
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('examples.manifest.json must be an array');
  return raw;
}

function validateEntries(entries) {
  const seenRoutes = new Set();
  const seenIds = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') throw new Error('Manifest entry must be an object');
    for (const key of ['id', 'route', 'title', 'description', 'folder', 'adapterModule', 'smokeSelector']) {
      if (typeof entry[key] !== 'string' || !entry[key].trim()) throw new Error(`Manifest entry missing ${key}`);
    }
    if (!/^[a-z0-9-]+$/.test(entry.route)) throw new Error(`Invalid route "${entry.route}"`);
    if (seenRoutes.has(entry.route)) throw new Error(`Duplicate route "${entry.route}"`);
    if (seenIds.has(entry.id)) throw new Error(`Duplicate id "${entry.id}"`);
    seenRoutes.add(entry.route);
    seenIds.add(entry.id);

    const adapterAbs = resolve(galleryDir, 'src', entry.adapterModule);
    if (!fs.existsSync(adapterAbs)) throw new Error(`Adapter module not found: ${entry.adapterModule}`);
  }
}

function syncRoutePages(entries) {
  const activeRoutes = new Set(entries.map((entry) => entry.route));

  // Cleanup stale generated route directories.
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
    fs.writeFileSync(resolve(routeDir, generatedMarker), `${entry.id}\n`, 'utf8');
    fs.writeFileSync(
      resolve(routeDir, 'index.html'),
      renderRouteHtml({ title: entry.title, route: entry.route }),
      'utf8',
    );
  }
}

function syncPublicAssets(entries) {
  const outDir = resolve(galleryDir, '.generated-public');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  for (const entry of entries) {
    const srcDir = resolve(galleryDir, '..', entry.folder, 'public');
    if (!fs.existsSync(srcDir)) continue;
    const dstDir = resolve(outDir, entry.route);
    copyDir(srcDir, dstDir);
  }
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const item of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = resolve(src, item.name);
    const dstPath = resolve(dst, item.name);
    if (item.isDirectory()) {
      copyDir(srcPath, dstPath);
    } else if (item.isFile()) {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function renderRouteHtml(args) {
  const escapedTitle = String(args.title)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
  const escapedRoute = String(args.route)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapedTitle}</title>
  </head>
  <body data-vacp-gallery-route="${escapedRoute}">
    <div id="gallery-example-root"></div>
    <script type="module" src="../src/route-entry.ts"></script>
  </body>
</html>
`;
}
