import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { EvalGateError } from '../results/gate';
import type { VacpRevision } from '../results/rows';

function git(root: string, args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
  } catch {
    return '';
  }
}

/**
 * The VACP code under test: the commit, and a digest of uncommitted changes to the packages and
 * examples, which is what a hillclimb round edits. New files count as changes.
 */
export function vacpRevision(root: string): VacpRevision {
  const hash = createHash('sha256').update(git(root, ['diff', 'HEAD', '--', 'packages', 'examples']));
  const added = git(root, ['ls-files', '--others', '--exclude-standard', '--', 'packages', 'examples'])
    .split('\n')
    .filter(Boolean)
    .sort();
  for (const file of added)
    hash
      .update(file)
      .update('\0')
      .update(readFileSync(join(root, file)));
  const changed = added.length > 0 || !!git(root, ['diff', '--stat', 'HEAD', '--', 'packages', 'examples']);
  return { commit: git(root, ['rev-parse', 'HEAD']), vacp_diff: changed ? hash.digest('hex').slice(0, 16) : 'clean' };
}

function newest(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .reduce((latest, entry) => Math.max(latest, statSync(join(entry.parentPath, entry.name)).mtimeMs), 0);
}

/**
 * The eval imports its `@vacp/*` dependencies from their built `dist`, while the gallery serves their
 * source. A package whose source changed after its build would measure old code, so the run stops.
 */
export function assertFreshBuilds(root: string) {
  const manifest = JSON.parse(readFileSync(join(root, 'apps/evals/package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  const stale = Object.keys(manifest.dependencies)
    .filter((name) => name.startsWith('@vacp/'))
    .map((name) => join(root, 'packages', name.slice('@vacp/'.length)))
    .filter((dir) => newest(join(dir, 'src')) > newest(join(dir, 'dist')));
  if (stale.length)
    throw new EvalGateError(
      `The built ${stale.map((dir) => dir.split('/').pop()).join(', ')} predate their source. Run \`make build-libs\` first.`,
    );
}
