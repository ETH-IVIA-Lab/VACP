import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearVacpBrowserOptionOverride,
  resolveVacpBrowserOptionDetails,
  setVacpBrowserOptionOverride,
  type VacpBrowserOptionKey,
} from '../src/options';

function memoryStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));

  return {
    getItem(key: string) {
      return values.has(key) ? values.get(key)! : null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

test('hyperparams resolve inspector on by default and allow explicit opt out', () => {
  assert.equal(resolveVacpBrowserOptionDetails().values.inspector, true);

  const disabled = resolveVacpBrowserOptionDetails({ url: 'http://example.test/?vacp-inspector=0' });
  assert.equal(disabled.values.inspector, false);
  assert.equal(disabled.details.inspector.source, 'url');
});

test('hyperparams expose browser storage overrides for VACP flags', () => {
  const storage = memoryStorage();

  assert.equal(setVacpBrowserOptionOverride('enableSql', false, storage), true);
  const disabled = resolveVacpBrowserOptionDetails({ storage });
  assert.equal(disabled.values.enableSql, false);
  assert.equal(disabled.details.enableSql.source, 'localStorage');
  assert.equal(disabled.details.enableSql.localStorageKey, 'vacp:enable-sql');

  assert.equal(clearVacpBrowserOptionOverride('enableSql', storage), true);
  const cleared = resolveVacpBrowserOptionDetails({ storage });
  assert.equal(cleared.values.enableSql, true);
  assert.equal(cleared.details.enableSql.source, 'default');
});

test('hyperparams keep URL and env above browser storage', () => {
  const storage = memoryStorage({ 'vacp:expose-bridge': '0' });

  const fromEnv = resolveVacpBrowserOptionDetails({
    env: { VACP_EXPOSE_BRIDGE: '1' },
    storage,
  });

  assert.equal(fromEnv.values.exposeBridge, true);
  assert.equal(fromEnv.details.exposeBridge.source, 'env');

  const fromUrl = resolveVacpBrowserOptionDetails({
    url: 'http://example.test/?expose-bridge=0',
    env: { VACP_EXPOSE_BRIDGE: '1' },
    storage,
  });

  assert.equal(fromUrl.values.exposeBridge, false);
  assert.equal(fromUrl.details.exposeBridge.source, 'url');
});

const URL_PRECEDENCE_CASES: readonly {
  key: VacpBrowserOptionKey;
  urlKey: string;
  envKey: string;
  storageKey: string;
}[] = [
  { key: 'inspector', urlKey: 'vacp-inspector', envKey: 'VACP_INSPECTOR', storageKey: 'vacp:inspector' },
  { key: 'exposeBridge', urlKey: 'expose-bridge', envKey: 'VACP_EXPOSE_BRIDGE', storageKey: 'vacp:expose-bridge' },
  { key: 'domSnapshot', urlKey: 'vacp-dom-snapshot', envKey: 'VACP_DOM_SNAPSHOT', storageKey: 'vacp:dom-snapshot' },
  { key: 'enableSql', urlKey: 'enable-sql', envKey: 'VACP_ENABLE_SQL', storageKey: 'vacp:enable-sql' },
];

for (const spec of URL_PRECEDENCE_CASES) {
  test(`hyperparams let URL disable ${spec.key} above env and storage`, () => {
    const resolved = resolveVacpBrowserOptionDetails({
      url: `http://example.test/?${spec.urlKey}=0`,
      env: { [spec.envKey]: '1' },
      storage: memoryStorage({ [spec.storageKey]: '1' }),
    });

    assert.equal(resolved.values[spec.key], false);
    assert.equal(resolved.details[spec.key].source, 'url');
    assert.equal(resolved.details[spec.key].raw, '0');
  });

  test(`hyperparams let URL enable ${spec.key} above env and storage`, () => {
    const resolved = resolveVacpBrowserOptionDetails({
      url: `http://example.test/?${spec.urlKey}=1`,
      env: { [spec.envKey]: '0' },
      storage: memoryStorage({ [spec.storageKey]: '0' }),
    });

    assert.equal(resolved.values[spec.key], true);
    assert.equal(resolved.details[spec.key].source, 'url');
    assert.equal(resolved.details[spec.key].raw, '1');
  });

  test(`hyperparams let URL presence claim ${spec.key} above env and storage`, () => {
    const resolved = resolveVacpBrowserOptionDetails({
      url: `http://example.test/?${spec.urlKey}`,
      env: { [spec.envKey]: '0' },
      storage: memoryStorage({ [spec.storageKey]: '0' }),
    });

    assert.equal(resolved.values[spec.key], true);
    assert.equal(resolved.details[spec.key].source, 'url');
    assert.equal(resolved.details[spec.key].raw, '');
  });

  test(`hyperparams keep unsupported URL values above env and storage for ${spec.key}`, () => {
    const resolved = resolveVacpBrowserOptionDetails({
      url: `http://example.test/?${spec.urlKey}=maybe`,
      env: { [spec.envKey]: '0' },
      storage: memoryStorage({ [spec.storageKey]: '0' }),
    });

    assert.equal(resolved.values[spec.key], true);
    assert.equal(resolved.details[spec.key].source, 'url');
    assert.equal(resolved.details[spec.key].raw, 'maybe');
  });
}

test('hyperparams let camel-case URL aliases override every lower level', () => {
  const resolved = resolveVacpBrowserOptionDetails({
    url: 'http://example.test/?exposeBridge=0',
    env: { VACP_EXPOSE_BRIDGE: '1' },
    storage: memoryStorage({ 'vacp:expose-bridge': '1' }),
  });

  assert.equal(resolved.values.exposeBridge, false);
  assert.equal(resolved.details.exposeBridge.source, 'url');
  assert.equal(resolved.details.exposeBridge.raw, '0');
});
