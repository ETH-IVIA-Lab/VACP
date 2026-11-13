import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parse, stringify } from 'yaml';

const usage = `Usage: pnpm pack:local [app-dir]

Builds and packs every @ethivia/vacp-* library into dist/npm. With an app directory, points the
app's pnpm overrides at those tarballs, so \`pnpm add @ethivia/vacp-sdk\` there installs the local
build exactly as it would install a published release. Rerun after changing VACP, then run
\`pnpm install\` in the app.`;

const { positionals, values } = parseArgs({ allowPositionals: true, options: { help: { type: 'boolean' } } });
if (values.help || positionals.length > 1) {
  console.log(usage);
  process.exit(values.help ? 0 : 1);
}

const root = fileURLToPath(new URL('../', import.meta.url));
const out = join(root, 'dist/npm');
rmSync(out, { recursive: true, force: true });
execFileSync('pnpm', ['exec', 'vp', 'run', '--filter', './packages/*', 'build'], { cwd: root, stdio: 'inherit' });
execFileSync('pnpm', ['--recursive', '--filter', './packages/*', 'pack', '--pack-destination', out], {
  cwd: root,
  stdio: 'ignore',
});

const tarballs: Record<string, string> = {};
for (const file of readdirSync(out).sort()) {
  const manifest = JSON.parse(
    execFileSync('tar', ['-xOzf', join(out, file), 'package/package.json'], { encoding: 'utf8' }),
  ) as { name: string };
  tarballs[manifest.name] = `file:${join(out, file)}`;
}
console.log(`Packed ${Object.keys(tarballs).length} packages into ${out}`);

const [app] = positionals;
if (app) {
  const workspace = join(resolve(app), 'pnpm-workspace.yaml');
  const config = (existsSync(workspace) ? parse(readFileSync(workspace, 'utf8')) : null) ?? {};
  config.overrides = { ...config.overrides, ...tarballs };
  writeFileSync(workspace, stringify(config));
  console.log(`Pointed ${workspace} at the local packages. Run \`pnpm install\` in ${resolve(app)}.`);
}
