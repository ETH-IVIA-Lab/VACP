import { z } from 'zod';
import { measure } from '../../../tools/benchmark';
import { executeVacpAction } from '@ethivia/vacp-runtime';
import { createVacpActions } from '../src/actions';

const actions = createVacpActions();
const action = actions
  .operation('mutation', 'brush', 'Set brush ranges')
  .params(z.object({ ranges: z.record(z.string(), z.tuple([z.coerce.number(), z.coerce.number()]).nullable()) }))
  .focus(({ ranges }) => ({ ref: 'vacp://chart', detail: { ranges } }))
  .affects('vacp://chart')
  .handle(({ ranges }) => ranges);
const call = { callId: 'bench', name: action.name, params: { ranges: { x: ['10', '20'], y: null } } };
const controller = new AbortController();
console.log(`Node ${process.version}; SDK validation, preparation and execution`);
const noSignal = await measure(
  'coerced brush with no signal',
  async () => {
    if (!(await executeVacpAction(actions.registry, call)).ok) throw new Error('Expected a valid action');
  },
  10_000,
);
const callerSignal = await measure(
  'coerced brush with caller signal',
  async () => {
    if (!(await executeVacpAction(actions.registry, call, { signal: controller.signal })).ok)
      throw new Error('Expected a valid action');
  },
  10_000,
);
const invalid = await measure(
  'invalid brush with structured diagnostics',
  async () => {
    if ((await executeVacpAction(actions.registry, { ...call, params: { ranges: { x: [1] } } })).ok)
      throw new Error('Expected validation failure');
  },
  1_000,
);

console.log(
  JSON.stringify({
    microsecondsPerOperation: { noSignal: noSignal * 1000, callerSignal: callerSignal * 1000, invalid: invalid * 1000 },
  }),
);
