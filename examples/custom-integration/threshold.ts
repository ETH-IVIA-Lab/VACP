import { createVacpProvider } from '@vacp/runtime';
import { installVacpRuntime } from '@vacp/runtime-browser';
import { createVacpActions } from '@vacp/sdk';
import { z } from 'zod';

const thresholdParams = z.object({ value: z.number().finite().min(0).max(100) });

type ThresholdControl = Pick<HTMLInputElement, 'value' | 'valueAsNumber' | 'addEventListener' | 'removeEventListener'>;

export function connectThreshold(input: ThresholdControl) {
  const ref = 'vacp://example/threshold';
  const actions = createVacpActions();

  actions
    .operation('mutation', 'threshold.set', 'Set the threshold between 0 and 100')
    .affects(ref)
    .params(thresholdParams)
    .focus(() => ({ ref }))
    .handle(({ value }) => {
      input.value = String(value);

      return { value: input.valueAsNumber };
    });

  const provider = createVacpProvider({
    source: { id: 'vacp-source://example/threshold', type: 'control', title: 'Threshold control' },
    actions: actions.registry,
    project: () => ({
      graph: {
        nodes: [{ ref, kind: 'Param', layer: 'ConfigLayer', title: 'Threshold' }],
        edges: [],
        actions: actions.registry.list(),
      },
      state: { [ref]: { value: input.valueAsNumber } },
    }),
    subscribe: (invalidate) => {
      input.addEventListener('input', invalidate);
      return () => input.removeEventListener('input', invalidate);
    },
  });
  const { runtime, dispose } = installVacpRuntime({
    providers: [provider],
    exposeBridge: true,
    injectDomSnapshot: true,
  });

  const onInput = () => {
    void runtime.refresh({ actor: { id: 'human', kind: 'human' }, message: 'Threshold changed' }).catch(() => {});
  };
  input.addEventListener('input', onInput);

  return {
    runtime,
    dispose() {
      input.removeEventListener('input', onInput);
      dispose();
    },
  };
}
