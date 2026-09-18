import assert from 'node:assert/strict';
import test from 'node:test';

import type { VacpActionDescriptor } from '@vacp/protocol';

import { createActionParamDraft, validateActionParams } from '../src/overlay/modules/action-params';

test('action params use descriptor defaults for provider actions', () => {
  const action: VacpActionDescriptor = {
    name: 'vgplot.set_interval_2d',
    description: 'Set a 2D interval selection.',
    parameters: {
      type: 'object',
      properties: {
        plotId: { type: 'string' },
        interactorId: { type: 'string' },
        x0: { type: 'number' },
        x1: { type: 'number' },
        y0: { type: 'number' },
        y1: { type: 'number' },
      },
      required: ['interactorId', 'x0', 'x1', 'y0', 'y1'],
      default: {
        plotId: 'plot-1',
        interactorId: '0',
        x0: 25,
        x1: 75,
        y0: 15,
        y1: 25,
      },
    },
  };

  const draft = createActionParamDraft(action, {});

  assert.deepEqual(draft.params, {
    plotId: 'plot-1',
    interactorId: '0',
    x0: 25,
    x1: 75,
    y0: 15,
    y1: 25,
  });
  assert.deepEqual(validateActionParams(action, draft.params), []);
});

test('action params seed data SQL from the first DataHandle', () => {
  const action: VacpActionDescriptor = {
    name: 'vacp.data_sql',
    description: 'Query a handle.',
    parameters: {
      type: 'object',
      properties: {
        handleRef: { type: 'string' },
        sql: { type: 'string' },
        maxRows: { type: 'number' },
      },
      required: ['handleRef', 'sql'],
    },
  };

  const draft = createActionParamDraft(action, {
    'vacp://example/data/main': { kind: 'DataHandle', table: 'cars' },
  });

  assert.deepEqual(draft.params, {
    handleRef: 'vacp://example/data/main',
    sql: 'SELECT COUNT(*)::INTEGER AS n FROM vacp_handle',
    maxRows: 10,
  });
});

test('action params do not infer provider-specific widget params without descriptor defaults', () => {
  const action: VacpActionDescriptor = {
    name: 'vgplot.set_input_value',
    description: 'Set input value.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        value: {},
      },
      required: ['ref', 'value'],
    },
  };

  const draft = createActionParamDraft(action, {
    'vacp://example/input/0': {
      kind: 'Widget',
      widgetKind: 'Slider',
      selectionValue: [10, 20],
    },
  });

  assert.deepEqual(draft.params, {});
  assert.deepEqual(validateActionParams(action, draft.params), [
    { path: 'ref', message: 'Required parameter is missing.' },
    { path: 'value', message: 'Required parameter is missing.' },
  ]);
});

test('action params do not seed option-index actions from widgets without options', () => {
  const action: VacpActionDescriptor = {
    name: 'vgplot.set_input_option_index',
    description: 'Set input option.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        index: { type: 'number' },
      },
      required: ['ref', 'index'],
    },
  };

  const draft = createActionParamDraft(action, {
    'vacp://example/input/0': {
      kind: 'Widget',
      widgetKind: 'Slider',
      selectionValue: [10, 20],
    },
  });

  assert.deepEqual(draft.params, {});
  assert.deepEqual(validateActionParams(action, draft.params), [
    { path: 'ref', message: 'Required parameter is missing.' },
    { path: 'index', message: 'Required parameter is missing.' },
  ]);
});

test('action param validation rejects missing required values before dispatch', () => {
  const action: VacpActionDescriptor = {
    name: 'vgplot.set_pan_zoom',
    description: 'Set a PanZoom view domain.',
    parameters: {
      type: 'object',
      properties: {
        interactorId: { type: 'string' },
        x0: { type: 'number' },
        x1: { type: 'number' },
      },
      required: ['interactorId'],
    },
  };

  assert.deepEqual(validateActionParams(action, {}), [
    { path: 'interactorId', message: 'Required parameter is missing.' },
  ]);
  assert.deepEqual(validateActionParams(action, { interactorId: '', x0: 'left' }), [
    { path: 'interactorId', message: 'Expected string.' },
    { path: 'x0', message: 'Expected number.' },
  ]);
});

test('action params do not invent empty arrays for required schema fields', () => {
  const action: VacpActionDescriptor = {
    name: 'example.set_order',
    description: 'Set order.',
    parameters: {
      type: 'object',
      properties: {
        order: { type: 'array' },
      },
      required: ['order'],
    },
  };

  const draft = createActionParamDraft(action, {});
  assert.deepEqual(draft.params, {});
  assert.deepEqual(validateActionParams(action, draft.params), [
    { path: 'order', message: 'Required parameter is missing.' },
  ]);
});
