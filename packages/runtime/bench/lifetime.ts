import { setImmediate } from 'node:timers/promises';
import { VACP_SCHEMA_VERSION, type VacpProvider } from '@vacp/protocol';
import { createVacpRuntime, type VacpRuntime } from '../src/index';

const collect = globalThis.gc;
if (!collect) throw new Error('Run this benchmark with --expose-gc');

async function closedRuntime() {
  const values = Array.from({ length: 50_000 }, (_, index) => index);
  let revision = 0;
  const provider: VacpProvider = {
    source: { id: 'vacp-source://lifetime', type: 'benchmark', title: 'Lifetime' },
    observe: () => ({
      revision: String(++revision),
      observedAt: '',
      graph: {
        version: VACP_SCHEMA_VERSION,
        nodes: [{ ref: 'vacp://values', kind: 'Param', layer: 'ConfigLayer' }],
        edges: [],
        actions: [],
      },
      state: { 'vacp://values': { revision, values } },
    }),
    prepare: async () => {
      throw new Error('No operations in this benchmark');
    },
  };
  const runtime = createVacpRuntime({ providers: [provider] });
  for (let index = 0; index < 8; index++) {
    await runtime.refresh();
    await runtime.getState({ mode: 'full' });
  }
  runtime.dispose();
  return runtime;
}

// Keep the disposed handles alive, as an inspection surface or host may do.
const retained: VacpRuntime[] = [];
collect();
const before = process.memoryUsage().heapUsed;
for (let index = 0; index < 3; index++) retained.push(await closedRuntime());
await setImmediate();
collect();
const after = process.memoryUsage().heapUsed;
if (!retained.every((runtime) => runtime.signal.aborted)) throw new Error('A runtime remains active');
console.log(`Node ${process.version}; 3 disposed runtimes retained; 8 recording/delta cycles; 50,000 values`);
console.log(`Retained heap: ${((after - before) / 1024 / 1024).toFixed(2)} MiB`);
