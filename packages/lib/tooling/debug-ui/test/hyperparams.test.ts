import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearVacpHyperParamStorageOverride,
  resolveVacpHyperParamDetails,
  setVacpHyperParamStorageOverride,
  type VacpHyperParamKey,
} from '../../../protocol/core/src/hyperparams';

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

test('hyperparams resolve debug UI on by default and allow explicit opt out', () => {
  assert.equal(resolveVacpHyperParamDetails().values.debugUi, true);

  const disabled = resolveVacpHyperParamDetails({ url: 'http://example.test/?vacp-debug=0' });
  assert.equal(disabled.values.debugUi, false);
  assert.equal(disabled.details.debugUi.source, 'url');
});

test('hyperparams expose browser storage overrides for VACP flags', () => {
  const storage = memoryStorage();

  assert.equal(setVacpHyperParamStorageOverride('enableSql', false, storage), true);
  const disabled = resolveVacpHyperParamDetails({ storage });
  assert.equal(disabled.values.enableSql, false);
  assert.equal(disabled.details.enableSql.source, 'localStorage');
  assert.equal(disabled.details.enableSql.localStorageKey, 'vacp:enable-sql');

  assert.equal(clearVacpHyperParamStorageOverride('enableSql', storage), true);
  const cleared = resolveVacpHyperParamDetails({ storage });
  assert.equal(cleared.values.enableSql, true);
  assert.equal(cleared.details.enableSql.source, 'default');
});

test('hyperparams keep URL and env above browser storage', () => {
  const storage = memoryStorage({ 'vacp:expose-bridge': '0' });

  const fromEnv = resolveVacpHyperParamDetails({
    env: { VACP_EXPOSE_BRIDGE: '1' },
    storage,
  });
  assert.equal(fromEnv.values.exposeBridge, true);
  assert.equal(fromEnv.details.exposeBridge.source, 'env');

  const fromUrl = resolveVacpHyperParamDetails({
    url: 'http://example.test/?expose-bridge=0',
    env: { VACP_EXPOSE_BRIDGE: '1' },
    storage,
  });
  assert.equal(fromUrl.values.exposeBridge, false);
  assert.equal(fromUrl.details.exposeBridge.source, 'url');
});

const URL_PRECEDENCE_CASES: readonly {
  key: VacpHyperParamKey;
  urlKey: string;
  envKey: string;
  storageKey: string;
}[] = [
  { key: 'debugUi', urlKey: 'vacp-debug', envKey: 'VACP_DEBUG_UI', storageKey: 'vacp:debug' },
  { key: 'exposeBridge', urlKey: 'expose-bridge', envKey: 'VACP_EXPOSE_BRIDGE', storageKey: 'vacp:expose-bridge' },
  { key: 'domSnapshot', urlKey: 'vacp-dom-snapshot', envKey: 'VACP_DOM_SNAPSHOT', storageKey: 'vacp:dom-snapshot' },
  { key: 'enableSql', urlKey: 'enable-sql', envKey: 'VACP_ENABLE_SQL', storageKey: 'vacp:enable-sql' },
];

for (const spec of URL_PRECEDENCE_CASES) {
  test(`hyperparams let URL disable ${spec.key} above env and storage`, () => {
    const resolved = resolveVacpHyperParamDetails({
      url: `http://example.test/?${spec.urlKey}=0`,
      env: { [spec.envKey]: '1' },
      storage: memoryStorage({ [spec.storageKey]: '1' }),
    });

    assert.equal(resolved.values[spec.key], false);
    assert.equal(resolved.details[spec.key].source, 'url');
    assert.equal(resolved.details[spec.key].raw, '0');
  });

  test(`hyperparams let URL enable ${spec.key} above env and storage`, () => {
    const resolved = resolveVacpHyperParamDetails({
      url: `http://example.test/?${spec.urlKey}=1`,
      env: { [spec.envKey]: '0' },
      storage: memoryStorage({ [spec.storageKey]: '0' }),
    });

    assert.equal(resolved.values[spec.key], true);
    assert.equal(resolved.details[spec.key].source, 'url');
    assert.equal(resolved.details[spec.key].raw, '1');
  });

  test(`hyperparams let URL presence claim ${spec.key} above env and storage`, () => {
    const resolved = resolveVacpHyperParamDetails({
      url: `http://example.test/?${spec.urlKey}`,
      env: { [spec.envKey]: '0' },
      storage: memoryStorage({ [spec.storageKey]: '0' }),
    });

    assert.equal(resolved.values[spec.key], true);
    assert.equal(resolved.details[spec.key].source, 'url');
    assert.equal(resolved.details[spec.key].raw, '');
  });

  test(`hyperparams keep unsupported URL values above env and storage for ${spec.key}`, () => {
    const resolved = resolveVacpHyperParamDetails({
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
  const resolved = resolveVacpHyperParamDetails({
    url: 'http://example.test/?exposeBridge=0',
    env: { VACP_EXPOSE_BRIDGE: '1' },
    storage: memoryStorage({ 'vacp:expose-bridge': '1' }),
  });

  assert.equal(resolved.values.exposeBridge, false);
  assert.equal(resolved.details.exposeBridge.source, 'url');
  assert.equal(resolved.details.exposeBridge.raw, '0');
});
