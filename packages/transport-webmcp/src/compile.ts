import type { WebMCP } from 'webmcp-types';
import { primaryOperationRef, type VacpGraph, type VacpActionDescriptor } from '@vacp/protocol';
import type { VacpWebMcpClient, VacpWebMcpOptions } from './types.js';

function copySchema(schema: Record<string, unknown>): Record<string, unknown> {
  const value = JSON.parse(JSON.stringify(schema));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Action parameters must describe a JSON Schema object');
  }
  return value;
}

function actionInput(action: VacpActionDescriptor, name: string, mode?: 'object' | 'params') {
  const schema = action.parameters ? copySchema(action.parameters) : undefined;
  // Object schemas (including $ref/allOf schemas) retain their original resource root.
  const wrapped = mode ? mode === 'params' : schema && 'type' in schema && schema.type !== 'object';
  if (!wrapped) return { schema, wrapped: false };

  // Give the nested schema its own resource so its local $refs retain their meaning.
  const resource = { ...schema };
  const idKey = String(schema?.$schema ?? '').includes('draft-04') ? 'id' : '$id';
  resource[idKey] ??= `urn:vacp:webmcp:${encodeURIComponent(name)}`;
  return {
    wrapped: true,
    schema: { type: 'object', properties: { params: resource }, required: ['params'], additionalProperties: false },
  };
}

/** Project a VACP graph into executable WebMCP tools without accessing the browser. */
export function compileVacpWebMcpTools(
  graph: VacpGraph,
  client: VacpWebMcpClient,
  options: VacpWebMcpOptions = {},
): WebMCP.ModelContextTool[] {
  const namespace = options.namespace ?? 'vacp';
  const nodes = new Map(graph.nodes.map((node) => [node.ref, node]));
  const tools: WebMCP.ModelContextTool[] = [
    {
      name: `${namespace}.observe`,
      description: 'Read one coherent VACP observation: sources, ownership, graph, state, summaries, and freshness.',
      annotations: { readOnlyHint: true },
      execute: async (_input, { signal }) => {
        signal.throwIfAborted();
        const result = await client.observe();
        signal.throwIfAborted();
        return result;
      },
    },
    {
      name: `${namespace}.capabilities`,
      description:
        'Read the live VACP graph: entities, stable references, relationships, and available semantic actions.',
      annotations: { readOnlyHint: true },
      execute: async (_input, { signal }) => {
        signal.throwIfAborted();
        const result = await client.getCapabilities();
        signal.throwIfAborted();
        return result;
      },
    },
    {
      name: `${namespace}.state`,
      description: 'Read current visualization state and summaries keyed by the stable references in the VACP graph.',
      annotations: { readOnlyHint: true },
      execute: async (_input, { signal }) => {
        signal.throwIfAborted();
        const result = await client.getState();
        signal.throwIfAborted();
        return result;
      },
    },
  ];

  for (const action of graph.actions) {
    if (options.includeAction && !options.includeAction(action, graph)) continue;
    const name = options.actionName?.(action) ?? `${namespace}.action.${action.name}`;
    const primaryRef = primaryOperationRef(action);
    const target = primaryRef ? nodes.get(primaryRef) : undefined;
    const context = target
      ? `\nTarget: ${target.title ?? target.ref} (${target.kind}, ${target.layer}). VACP ref: ${target.ref}.`
      : primaryRef
        ? `\nVACP target: ${primaryRef}.`
        : '';
    const input = actionInput(action, name, options.inputMode?.(action));
    tools.push({
      name,
      title: action.title,
      description: `${action.description}${context}`,
      inputSchema: input.schema,
      annotations: options.annotations?.(action),
      execute: async (args, { signal }) => {
        signal.throwIfAborted();
        const result = await client.execute(
          {
            callId: crypto.randomUUID(),
            name: action.name,
            params: input.wrapped ? args.params : args,
          },
          { signal },
        );
        signal.throwIfAborted();
        return result;
      },
    });
  }

  const names = new Set<string>();
  for (const tool of tools) {
    if (!/^[A-Za-z0-9_.-]{1,128}$/.test(tool.name)) {
      throw new TypeError(`Invalid WebMCP tool name: ${tool.name}. Set namespace or actionName to a valid name.`);
    }
    if (names.has(tool.name)) throw new TypeError(`Duplicate WebMCP tool name: ${tool.name}`);
    if (!tool.description.trim()) throw new TypeError(`WebMCP tool ${tool.name} needs a description`);
    names.add(tool.name);
  }
  return tools;
}
