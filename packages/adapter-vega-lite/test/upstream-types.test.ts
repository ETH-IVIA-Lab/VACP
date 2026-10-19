import assert from 'node:assert/strict';
import test from 'node:test';
import type { View } from 'vega';
import { createVegaLiteProvider } from '@ethivia/vacp-adapter-vega-lite';

type RequiresHandler = [] extends Parameters<View['tooltip']> ? false : true;

test('importing the adapter preserves Vega tooltip argument requirements', () => {
  const required: RequiresHandler = true;
  assert.equal(required, true);
  assert.equal(typeof createVegaLiteProvider, 'function');
});
