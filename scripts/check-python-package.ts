import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const { values } = parseArgs({
  options: {
    python: { type: 'string', default: '3.12' },
    uv: { type: 'string', default: 'uv' },
  },
});
const root = fileURLToPath(new URL('../', import.meta.url));
const version = execFileSync(values.uv, ['version', '--package', 'vacp', '--short'], {
  cwd: root,
  encoding: 'utf8',
}).trim();

for (const distribution of [`dist/python/vacp-${version}-py3-none-any.whl`, `dist/python/vacp-${version}.tar.gz`]) {
  const isolated = ['run', '--isolated', '--no-project', '--python', values.python];
  execFileSync(
    values.uv,
    [
      ...isolated,
      '--with',
      distribution,
      '--with',
      'pytest>=9',
      'python',
      '-I',
      '-m',
      'pytest',
      '-c',
      '/dev/null',
      '-p',
      'no:cacheprovider',
      '--import-mode=importlib',
      'packages/python/distribution',
    ],
    { cwd: root, stdio: 'inherit' },
  );
  execFileSync(
    values.uv,
    [
      ...isolated,
      '--with',
      `${distribution}[server,http]`,
      '--with',
      'pytest>=9',
      '--with',
      'pytest-asyncio>=0.24.0',
      'python',
      '-I',
      '-m',
      'pytest',
    ],
    { cwd: root, stdio: 'inherit' },
  );
}
