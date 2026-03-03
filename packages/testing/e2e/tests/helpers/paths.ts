import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const helperDir = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(helperDir, '..', '..', '..', '..', '..');
export const examplesRoot = resolve(repoRoot, 'packages', 'examples');

export function exampleDir(name: string): string {
  return resolve(examplesRoot, name);
}

export function artifactDir(name: string): string {
  return resolve(repoRoot, '.artifacts', name);
}
