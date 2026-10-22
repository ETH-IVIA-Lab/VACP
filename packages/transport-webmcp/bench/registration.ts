import { performance } from 'node:perf_hooks';
import { VACP_SCHEMA_VERSION, type VacpGraph, type VacpCapabilitiesSnapshot } from '@ethivia/vacp-protocol';
import { installVacpWebMcp, type VacpWebMcpSource } from '../src/index';

const revisions: VacpGraph[] = Array.from({ length: 51 }, (_, revision) => ({
  sources: [{ id: 'vacp-source://benchmark', type: 'benchmark', title: 'WebMCP benchmark' }],
  ownership: {
    nodes: {},
    actions: Object.fromEntries(Array.from({ length: 1_000 }, (_, i) => [`set.${i}`, 'vacp-source://benchmark'])),
  },
  nodes: [],
  edges: [],
  actions: Array.from({ length: 1_000 }, (_, i) => ({
    name: `set.${i}`,
    description: `Set parameter ${i}, revision ${revision}`,
    operation: { kind: 'evaluation' },
    parameters: { type: 'object', properties: { value: { type: 'number' } } },
  })),
}));

async function measureBurst() {
  let graph = revisions[0]!;
  let publish!: (snapshot: VacpCapabilitiesSnapshot) => void;
  let registrations = 0;
  const source: VacpWebMcpSource = {
    signal: new AbortController().signal,
    observe: async () => ({
      version: VACP_SCHEMA_VERSION,
      revision: 'benchmark',
      observedAt: '',
      graph,
      state: {},
    }),
    subscribeCapabilities: (listener) => {
      publish = listener;
      return () => {};
    },
    getCapabilities: async () => ({ version: VACP_SCHEMA_VERSION, createdAt: '', graph }),
    getState: async () => {
      throw new Error('This benchmark only registers tools');
    },
    execute: async () => {
      throw new Error('This benchmark only registers tools');
    },
    narrate: () => {},
  };
  const installation = await installVacpWebMcp(source, {
    context: {
      registerTool: async () => {
        registrations++;
      },
    },
  });
  if (!installation) throw new Error('Expected a registration handle');
  try {
    registrations = 0;
    const start = performance.now();
    for (const revision of revisions.slice(1)) {
      graph = revision;
      publish({ version: VACP_SCHEMA_VERSION, createdAt: '', graph });
    }
    await installation.refresh();
    return { ms: performance.now() - start, registrations };
  } finally {
    installation.dispose();
  }
}

console.log(`Node ${process.version}; 50 graph revisions x 1,000 actions; immediate registry port`);
await measureBurst();
await measureBurst();
const rounds: Awaited<ReturnType<typeof measureBurst>>[] = [];
for (let i = 0; i < 5; i++) rounds.push(await measureBurst());
rounds.sort((a, b) => a.ms - b.ms);
const median = rounds[2]!;
console.log(`Catalog burst: ${median.ms.toFixed(3)} ms, ${median.registrations} registrations (median of 5)`);
