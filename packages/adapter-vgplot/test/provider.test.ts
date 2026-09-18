import assert from 'node:assert/strict';
import test from 'node:test';
import { createVgplotProvider, type VgplotInteractorLike, type VgplotPlotLike } from '../src/index';

test('provider subscriptions release selection patches and rebind the same live dashboard', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const selection = {
    value: 0,
    update(value: unknown) {
      this.value = Number(value);
    },
  };
  const original = selection.update;
  const init = () => {};
  const interactor: VgplotInteractorLike = { constructor: { name: 'Toggle' }, selection, init };
  const plot: VgplotPlotLike = { marks: [], interactors: [interactor] };
  const create = () =>
    createVgplotProvider({
      plots: [{ plotId: 'scatter', plot }],
      options: { appId: 'test', viewId: 'overview' },
    });
  const first = create();
  assert.equal(selection.update, original);
  let firstChanges = 0;
  const detach = first.subscribe!(() => firstChanges++);
  selection.update(1);
  detach();
  t.mock.timers.tick(120);
  assert.equal(firstChanges, 0);
  assert.equal(selection.update, original);
  assert.equal(interactor.init, init);
  first.dispose!();
  const second = create();
  let changes = 0;
  second.subscribe!(() => changes++);
  selection.update(2);
  t.mock.timers.tick(120);
  assert.equal(changes, 1);
  second.dispose!();
  assert.equal(selection.update, original);
  assert.equal(interactor.init, init);
});

test('failed dashboard binding rolls back patches and isolates consumer failures', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const selection = { update() {} };
  const original = selection.update;
  const interactor: VgplotInteractorLike = { constructor: { name: 'Toggle' }, selection };
  Object.defineProperty(interactor, 'init', { value: () => {}, writable: false, configurable: true });
  const provider = createVgplotProvider({
    plots: [{ plotId: 'chart', plot: { marks: [], interactors: [interactor] } }],
    options: { appId: 'test', viewId: 'failure' },
  });
  assert.throws(() => provider.subscribe!(() => {}), TypeError);
  assert.equal(selection.update, original);
  Object.defineProperty(interactor, 'init', { writable: true });
  provider.subscribe!(() => {
    throw new Error('consumer failed');
  });
  let changes = 0;
  provider.subscribe!(() => changes++);
  selection.update();
  t.mock.timers.tick(120);
  assert.equal(changes, 1);
  provider.dispose!();
  assert.equal(selection.update, original);
});
