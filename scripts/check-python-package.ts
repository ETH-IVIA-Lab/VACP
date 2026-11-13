import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Builds the `vacp` wheel and sdist, checks their PyPI metadata, and tests each one installed in an
// isolated environment. uv reads the Python version from `UV_PYTHON`, else `.python-version`.
const root = fileURLToPath(new URL('../', import.meta.url));
const out = 'dist/python';
const uv = (...args: string[]) => execFileSync('uv', args, { cwd: root, stdio: 'inherit' });

rmSync(new URL(`../${out}`, import.meta.url), { recursive: true, force: true });
uv('build', '--package', 'vacp', '--no-sources', '--out-dir', out);
const version = execFileSync('uv', ['version', '--package', 'vacp', '--short'], { cwd: root, encoding: 'utf8' }).trim();
const distributions = [`${out}/vacp-${version}-py3-none-any.whl`, `${out}/vacp-${version}.tar.gz`];
uv('run', '--locked', 'twine', 'check', '--strict', ...distributions);

const pytest = ['python', '-I', '-m', 'pytest'];
for (const distribution of distributions) {
  const isolated = ['run', '--isolated', '--no-project', '--with', 'pytest>=9'];
  uv(
    ...isolated,
    '--with',
    distribution,
    ...pytest,
    '-c',
    '/dev/null',
    '-p',
    'no:cacheprovider',
    '--import-mode=importlib',
    'packages/python/distribution',
  );
  uv(...isolated, '--with', `${distribution}[server,http]`, '--with', 'pytest-asyncio>=0.24.0', ...pytest);
}
