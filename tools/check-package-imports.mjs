import { readFile } from 'node:fs/promises';

const packages = [
  'protocol',
  'runtime',
  'inspector-core',
  'presence-core',
  'presence-browser',
  'transport-bridge',
  'transport-webmcp',
  'agent-ai-sdk',
];

for (const name of packages) {
  const root = new URL(`../packages/${name}/`, import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  for (const [entry, conditions] of Object.entries(manifest.exports)) {
    if (typeof conditions.default !== 'string' || !conditions.default.endsWith('.js')) continue;
    await import(new URL(conditions.default, root).href);
    console.log(`Imported ${manifest.name}${entry === '.' ? '' : entry.slice(1)}`);
  }
}
