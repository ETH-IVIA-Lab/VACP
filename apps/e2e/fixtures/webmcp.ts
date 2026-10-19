import { z } from 'zod';
import { createVacpProvider, createVacpRuntime } from '@ethivia/vacp-runtime';
import { createVacpActions } from '@ethivia/vacp-sdk';
import { installVacpWebMcp } from '@ethivia/vacp-webmcp';

export async function exerciseWebMcpSchemas() {
  const context = document.modelContext;
  if (!context) throw new Error('Native WebMCP unavailable');
  const actions = createVacpActions();
  actions
    .operation('query', 'scalar', 'Echo a constrained scalar')
    .params(z.union([z.string().min(1), z.number().min(0)]))
    .handle((value) => value);
  actions
    .operation('query', 'nullable', 'Echo a nullable record')
    .params(z.object({ label: z.string() }).nullable())
    .handle((value) => value);
  const tree = z.object({
    label: z.string(),
    get children() {
      return z.array(tree);
    },
  });
  actions
    .operation('query', 'tree', 'Read labels from a recursive tree')
    .params(tree.meta({ id: 'WebMcpTree' }))
    .handle(({ label, children }) => [label, ...children.map((child) => child.label)]);
  const provider = createVacpProvider({
    source: { id: 'vacp-source://schema-test', type: 'test', title: 'Schema inputs' },
    actions: actions.registry,
    project: () => ({ graph: { nodes: [], edges: [], actions: actions.registry.list() }, state: {} }),
    subscribe: () => () => {},
  });
  const runtime = createVacpRuntime({ providers: [provider] });
  try {
    await installVacpWebMcp(runtime, { namespace: 'schema' });
    const tools = await context.getTools();
    const execute = async (name: string, params: unknown) => {
      const tool = tools.find((entry) => entry.name === `schema.action.${name}`);
      if (!tool) throw new Error(`Missing schema tool: ${name}`);
      return JSON.parse(await context.executeTool(tool, { params, narration: 'Checking the input.' }));
    };
    return {
      schemas: Object.fromEntries(
        tools.filter((tool) => tool.name.startsWith('schema.action.')).map((tool) => [tool.name, tool.inputSchema]),
      ),
      scalar: await execute('scalar', 4),
      text: await execute('scalar', 'hello'),
      nullable: await execute('nullable', null),
      object: await execute('nullable', { label: 'leaf' }),
      tree: await execute('tree', { label: 'root', children: [{ label: 'leaf', children: [] }] }),
    };
  } finally {
    runtime.dispose();
  }
}
