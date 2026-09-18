import { z } from 'zod';

const thresholdParams = z.object({ value: z.number().finite().min(0).max(100) });

import { VACP_SCHEMA_VERSION } from '@vacp/protocol';
import { createVacpActions, installVacp } from '@vacp/sdk';

type ThresholdControl = Pick<HTMLInputElement, 'value' | 'valueAsNumber' | 'addEventListener' | 'removeEventListener'>;

export function connectThreshold(input: ThresholdControl) {
  const ref = 'vacp://example/threshold';
  const actions = createVacpActions();

  actions
    .action('threshold.set', 'Set the threshold between 0 and 100')
    .target(ref)
    .params(
      {
        type: 'object',
        properties: { value: { type: 'number', minimum: 0, maximum: 100 } },
        required: ['value'],
      },
      thresholdParams,
    )
    .handle(({ value }) => {
      input.value = String(value);

      return { value: input.valueAsNumber };
    });

  const integration = installVacp({
    graph: {
      version: VACP_SCHEMA_VERSION,
      nodes: [{ ref, kind: 'Param', layer: 'ConfigLayer', title: 'Threshold' }],
      edges: [],
    },
    actions: actions.registry,
    getState: () => ({ [ref]: { value: input.valueAsNumber } }),
  });

  const onInput = () => integration.refresh('human', 'Threshold changed');
  input.addEventListener('input', onInput);

  return {
    bridge: integration.bridge,
    dispose() {
      input.removeEventListener('input', onInput);
      integration.dispose();
    },
  };
}
