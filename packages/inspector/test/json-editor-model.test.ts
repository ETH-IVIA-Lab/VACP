import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deleteJsonPath,
  parseJsonEditorPath,
  renameJsonKey,
  setJsonPath,
} from '../src/ui/components/ui/json-editor-model';

test('json editor paths set nested values without mutating the source object', () => {
  const source = { params: { order: ['A', 'B'] } };
  const next = setJsonPath(source, parseJsonEditorPath('/params/order/1'), 'C');

  assert.deepEqual(source, { params: { order: ['A', 'B'] } });
  assert.deepEqual(next, { params: { order: ['A', 'C'] } });
});

test('json editor paths allow exact root keys for ref-shaped state maps', () => {
  const ref = 'vacp://example/view/input/0';
  const next = setJsonPath({}, parseJsonEditorPath(ref), { selectionValue: 'cars' });

  assert.deepEqual(next, {
    [ref]: { selectionValue: 'cars' },
  });
});

test('json editor paths preserve JSON Pointer empty segments', () => {
  const next = setJsonPath({}, parseJsonEditorPath('/'), 'empty key');

  assert.deepEqual(parseJsonEditorPath('/params//name'), ['params', '', 'name']);
  assert.deepEqual(next, { '': 'empty key' });
});

test('json editor paths reject sparse array writes', () => {
  const source = { params: { order: ['A'] } };

  assert.throws(() => setJsonPath(source, parseJsonEditorPath('/params/order/2'), 'C'), /cannot skip past length 1/);
});

test('json editor paths delete array entries and object fields', () => {
  const source = { params: { order: ['A', 'B', 'C'], transient: true } };
  const withoutArrayItem = deleteJsonPath(source, parseJsonEditorPath('/params/order/1'));
  const withoutField = deleteJsonPath(withoutArrayItem, parseJsonEditorPath('/params/transient'));

  assert.deepEqual(withoutField, { params: { order: ['A', 'C'] } });
});

test('json editor key rename preserves sibling values and rejects duplicate keys', () => {
  const source = { params: { order: ['A'], filter: null } };
  const renamed = renameJsonKey(source, parseJsonEditorPath('/params/filter'), 'where');

  assert.deepEqual(renamed, { params: { order: ['A'], where: null } });
  assert.throws(() => renameJsonKey(source, parseJsonEditorPath('/params/filter'), 'order'), /already has key/);
});
