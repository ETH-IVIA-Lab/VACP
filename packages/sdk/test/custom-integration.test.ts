import { getVacpBridge } from '@ethivia/vacp-browser';
import assert from 'node:assert/strict';
import test from 'node:test';
import { connectThreshold } from '../../../examples/custom-integration/threshold';

class Input extends EventTarget {
  value = '10';
  get valueAsNumber() {
    return Number(this.value);
  }
}

test('documented integration shares a control between semantic actions and human input', async () => {
  const input = new Input();
  const integration = connectThreshold(input);

  try {
    const capabilities = await integration.runtime.getCapabilities();
    assert.equal(capabilities.graph.actions[0]?.name, 'threshold.set');
    assert.equal((await integration.runtime.execute({ name: 'threshold.set', params: { value: 42 } })).ok, true);
    assert.equal(input.value, '42');
    input.value = '75';
    input.dispatchEvent(new Event('input'));
    assert.deepEqual((await integration.runtime.observe()).state['vacp://example/threshold'], { value: 75 });
    assert.equal((await integration.runtime.execute({ name: 'threshold.set', params: { value: 101 } })).ok, false);
    assert.equal(input.value, '75');
  } finally {
    integration.dispose();
  }

  assert.equal(getVacpBridge(), undefined);
});
