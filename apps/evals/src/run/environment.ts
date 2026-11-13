import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
