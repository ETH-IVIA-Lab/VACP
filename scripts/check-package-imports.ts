import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { z } from 'zod';

const packageManifest = z.object({
  name: z.string(),
  version: z.string(),
  exports: z.record(z.string(), z.object({ default: z.string().optional() })).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});

// Published tarballs carry the build output, the README, and the root LICENSE.
const publishedFile = /^package\/(?:LICENSE|README\.md|package\.json|dist\/.+)$/;

// Install the tarballs that `pnpm pack:local` wrote to dist/npm into a consumer outside the
// workspace, so each package resolves only what its published manifest declares. The consumer adds
// every peer at the version the workspace tests against, and imports each public export with no
// loader, path aliases, or source conditions.
const workspaceRoot = fileURLToPath(new URL('..', import.meta.url));
const tarballs = join(workspaceRoot, 'dist/npm');
const consumer = await mkdtemp(join(tmpdir(), 'vacp-package-imports-'));
try {
  const packages: Record<string, string> = {};
  const peers: Record<string, string> = {};
  const imports: string[] = [];
  for (const tarball of (await readdir(tarballs)).sort()) {
    const path = join(tarballs, tarball);
    const files = execFileSync('tar', ['-tzf', path], { encoding: 'utf8' }).trim().split('\n');
    const unexpected = files.filter((file) => !publishedFile.test(file));
    if (unexpected.length) throw new Error(`${tarball} publishes files outside dist: ${unexpected.join(', ')}`);
    for (const file of ['package/LICENSE', 'package/README.md'])
      if (!files.includes(file)) throw new Error(`${tarball} is missing ${file}.`);
    const manifest = packageManifest.parse(
      JSON.parse(execFileSync('tar', ['-xOzf', path, 'package/package.json'], { encoding: 'utf8' })),
    );
    packages[manifest.name] = `file:${path}`;
    // An integration that bundled or depended on its own core could load a second runtime.
    if (
      manifest.name !== '@ethivia/vacp-sdk' &&
      (!manifest.peerDependencies?.['@ethivia/vacp-sdk'] || manifest.dependencies?.['@ethivia/vacp-sdk'])
    )
      throw new Error(`${manifest.name} must list @ethivia/vacp-sdk as a peer dependency only.`);
    for (const name of Object.keys(manifest.peerDependencies ?? {})) {
      const tested = manifest.devDependencies?.[name];
      if (!tested) throw new Error(`${manifest.name} tests no version of its peer ${name}.`);
      peers[name] = tested;
    }
    for (const [entry, conditions] of Object.entries(manifest.exports ?? {})) {
      if (typeof conditions.default !== 'string' || !/\.[cm]?js$/.test(conditions.default)) continue;
      const name = `${manifest.name}${entry === '.' ? '' : entry.slice(1)}`;
      imports.push(`import * as entry${imports.length} from ${JSON.stringify(name)};`);
    }
  }

  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({
      name: 'vacp-package-consumer',
      private: true,
      type: 'module',
      dependencies: { ...peers, ...packages },
    }),
  );
  // Published ranges such as `@ethivia/vacp-sdk: ^0.1.0` resolve to the local tarballs. Missing
  // or mismatched peers fail the install. JSON is valid YAML.
  await writeFile(
    join(consumer, 'pnpm-workspace.yaml'),
    JSON.stringify({
      overrides: packages,
      autoInstallPeers: false,
      strictPeerDependencies: true,
      strictDepBuilds: false,
      minimumReleaseAge: 0,
    }),
  );
  execFileSync('pnpm', ['install', '--prefer-offline'], { cwd: consumer, stdio: 'inherit' });

  const source = imports.join('\n');
  const runtimeFile = join(consumer, 'consumer.mjs');
  await writeFile(runtimeFile, source);
  execFileSync(process.execPath, ['--no-strip-types', runtimeFile], { cwd: consumer, stdio: 'inherit' });

  const typesFile = join(consumer, 'consumer.mts');
  await writeFile(typesFile, source);
  const program = ts.createProgram([typesFile], {
    noEmit: true,
    strict: true,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    skipLibCheck: false,
    allowImportingTsExtensions: false,
    types: ['node'],
    typeRoots: [fileURLToPath(new URL('./node_modules/@types/', import.meta.url))],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) {
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCurrentDirectory: () => consumer,
        getCanonicalFileName: (name) => name,
        getNewLine: () => '\n',
      }),
    );
  }
  const workspaceFiles = program
    .getSourceFiles()
    .filter((file) => file.fileName.startsWith(workspaceRoot) && !file.fileName.includes('/node_modules/'));
  if (workspaceFiles.length)
    throw new Error(
      `Package declarations reach the workspace: ${workspaceFiles.map((file) => file.fileName).join(', ')}`,
    );
  console.log(
    `Verified ${imports.length} public exports of ${Object.keys(packages).length} packed packages in native Node and a strict NodeNext TypeScript consumer.`,
  );
} finally {
  await rm(consumer, { recursive: true, force: true });
}
