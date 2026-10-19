import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Exercise public exports as a consumer, with no loader, path aliases, or source-import options.
const packagesRoot = new URL('../packages/', import.meta.url);
const consumer = await mkdtemp(join(tmpdir(), 'vacp-package-imports-'));
try {
  const modules = join(consumer, 'node_modules', '@ethivia');
  await mkdir(modules, { recursive: true });
  const imports = [];
  for (const directory of await readdir(packagesRoot, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const root = new URL(`${directory.name}/`, packagesRoot);
    const manifestPath = new URL('package.json', root);
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') continue; // Python workspace members have no JavaScript exports.
      throw error;
    }
    await symlink(fileURLToPath(root), join(modules, manifest.name.slice('@ethivia/'.length)), 'dir');
    for (const [entry, conditions] of Object.entries(manifest.exports ?? {})) {
      if (typeof conditions.default !== 'string' || !/\.[cm]?js$/.test(conditions.default)) continue;
      const name = `${manifest.name}${entry === '.' ? '' : entry.slice(1)}`;
      imports.push(`import * as entry${imports.length} from ${JSON.stringify(name)};`);
    }
  }
  const source = imports.join('\n');
  const runtimeFile = join(consumer, 'consumer.mjs');
  await writeFile(runtimeFile, source);
  execFileSync(process.execPath, ['--no-strip-types', runtimeFile], { stdio: 'inherit' });

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
    typeRoots: [fileURLToPath(new URL('../node_modules/@types/', import.meta.url))],
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
  const sourceImports = program
    .getSourceFiles()
    .filter((file) => file.fileName.startsWith(fileURLToPath(packagesRoot)) && !file.isDeclarationFile);
  if (sourceImports.length)
    throw new Error(`Package declarations depend on source: ${sourceImports.map((file) => file.fileName).join(', ')}`);
  console.log(`Verified ${imports.length} public exports in native Node and a strict NodeNext TypeScript consumer.`);
} finally {
  await rm(consumer, { recursive: true, force: true });
}
