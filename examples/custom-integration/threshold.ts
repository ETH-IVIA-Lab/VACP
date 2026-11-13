import { createVacpActions, createVacpProvider, installVacpRuntime, vacpHumanActor } from '@ethivia/vacp-sdk';
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
    actions,
    project: () => ({
      graph: {
        nodes: [{ ref, kind: 'Param', layer: 'ConfigLayer', title: 'Threshold' }],
      },
      state: { [ref]: { value: input.valueAsNumber } },
    }),
  });
  const { runtime, dispose } = installVacpRuntime({
    providers: [provider],
    exposeBridge: true,
  });

  const onChange = () => {
    void runtime.record({ actor: vacpHumanActor, message: 'Threshold changed' }).catch(() => {});
  };
  input.addEventListener('change', onChange);

  return {
    runtime,
    dispose() {
      input.removeEventListener('change', onChange);
      dispose();
    },
  };
}
