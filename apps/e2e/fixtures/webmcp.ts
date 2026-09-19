import { z } from 'zod';
import { createVacpActions, createVacpProvider } from '@vacp/sdk';
import { createVacpRuntime } from '@vacp/runtime';
import { installVacpWebMcp } from '@vacp/transport-webmcp';

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
    project: () => ({
      graph: { version: '0.1.0', nodes: [], edges: [], actions: actions.registry.list() },
      state: {},
    }),
  });
  const runtime = createVacpRuntime({ providers: [provider] });
  try {
    await installVacpWebMcp(runtime, { namespace: 'schema' });
    const tools = await context.getTools();
    const execute = async (name: string, params: unknown) => {
      const tool = tools.find((entry) => entry.name === `schema.action.${name}`);
      if (!tool) throw new Error(`Missing schema tool: ${name}`);
      return JSON.parse(await context.executeTool(tool, JSON.stringify({ params })));
    };
    return {
      schemas: Object.fromEntries(
        tools
          .filter((tool) => tool.name.startsWith('schema.action.'))
          .map((tool) => {
            // Chromium's experimental discovery API serializes schemas, unlike the draft types.
            const schema: unknown = tool.inputSchema;
            if (typeof schema !== 'string') throw new Error('Expected a serialized native tool schema');
            return [tool.name, JSON.parse(schema)];
          }),
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
