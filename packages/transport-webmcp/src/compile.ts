import { webMcpExecutionSignal } from './execution';
import type { WebMCP } from 'webmcp-types';
import {
  parseVacpNarration,
  primaryOperationRef,
  resolveVacpAvailability,
  vacpNarrationGuidance,
  VACP_NARRATION_MAX_LENGTH,
  type VacpGraph,
  type VacpActionDescriptor,
  type VacpActor,
  vacpToolRead,
  vacpToolResult,
} from '@vacp/protocol';
import type { VacpWebMcpClient, VacpWebMcpOptions } from './types';

function copySchema(schema: Record<string, unknown>): Record<string, unknown> {
  const value = JSON.parse(JSON.stringify(schema));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Action parameters must describe a JSON Schema object');
  }
  return value;
}

const narration = {
  type: 'string',
  minLength: 1,
  maxLength: VACP_NARRATION_MAX_LENGTH,
  description: vacpNarrationGuidance,
};

/** Each available action is a tool of its own, so graph reads leave actions out. */
function withoutActions<Graph extends { actions: unknown }>(graph: Graph): Omit<Graph, 'actions'> {
  const { actions: _, ...entities } = graph;
  return entities;
}

function entityRead<Read extends { graph: VacpGraph<unknown> }>(read: Read) {
  const { graph, ...rest } = vacpToolRead(read);
  return { ...rest, graph: withoutActions(graph) };
}

/** WebMCP steps belong to one agent unless the host names another. */
export const webMcpAgent: VacpActor = { id: 'webmcp', label: 'Agent', kind: 'agent' };

/**
 * Every action tool asks for the step's own sentence in `narration`, beside the action's own
 * parameters. Parameters that are not an object, or that already use that name, move under `params`.
 */
function actionInput(action: VacpActionDescriptor, name: string, mode?: 'object' | 'params') {
  const schema = action.parameters ? copySchema(action.parameters) : undefined;
  const properties = schema?.properties;
  const collides = !!properties && typeof properties === 'object' && Object.hasOwn(properties, 'narration');
  const nested = schema !== undefined && (schema.type !== 'object' || collides);
  if (mode === 'object' && nested)
    throw new TypeError(`${name} needs inputMode 'params': its parameters cannot sit beside narration`);
  if (mode === 'object' || (mode === undefined && !nested)) {
    const root = schema ?? { type: 'object' };
    const required = Array.isArray(root.required) ? root.required : [];
    return {
      wrapped: false,
      schema: {
        ...root,
        type: 'object',
        properties: { ...(root.properties as Record<string, unknown> | undefined), narration },
        required: [...required, 'narration'],
      },
    };
  }

  // Give the nested schema its own resource so its local $refs retain their meaning.
  const resource = { ...schema };
  const idKey = String(schema?.$schema ?? '').includes('draft-04') ? 'id' : '$id';
  resource[idKey] ??= `urn:vacp:webmcp:${encodeURIComponent(name)}`;
  return {
    wrapped: true,
    schema: {
      type: 'object',
      properties: { params: resource, narration },
      required: ['params', 'narration'],
      additionalProperties: false,
    },
  };
}

/**
 * Project a VACP graph into executable WebMCP tools without accessing the browser. Every read and
 * action result reaches the model within the limits of `vacpToolResult`.
 */
export function compileVacpWebMcpTools(
  graph: VacpGraph,
  client: VacpWebMcpClient,
  options: VacpWebMcpOptions = {},
): WebMCP.ModelContextTool[] {
  const namespace = options.namespace ?? 'vacp';
  const availability = resolveVacpAvailability(graph);
  const nodes = new Map(graph.nodes.map((node) => [node.ref, node]));
  const tools: WebMCP.ModelContextTool[] = [
    {
      name: `${namespace}.observe`,
      description:
        'Read one coherent VACP observation: sources, entities, relationships, state, summaries, and freshness. Each available action is its own tool.',
      annotations: { readOnlyHint: true },
      execute: async (_input, context) => {
        const signal = webMcpExecutionSignal(context);
        signal.throwIfAborted();
        const result = await client.observe();
        signal.throwIfAborted();
        return vacpToolResult(entityRead(result));
      },
    },
    {
      name: `${namespace}.capabilities`,
      description:
        'Read the live VACP graph: entities, stable references, and relationships. Each available action is its own tool.',
      annotations: { readOnlyHint: true },
      execute: async (_input, context) => {
        const signal = webMcpExecutionSignal(context);
        signal.throwIfAborted();
        const result = await client.getCapabilities();
        signal.throwIfAborted();
        return vacpToolResult(entityRead(result));
      },
    },
    {
      name: `${namespace}.state`,
      description: 'Read current visualization state and summaries keyed by the stable references in the VACP graph.',
      annotations: { readOnlyHint: true },
      execute: async (_input, context) => {
        const signal = webMcpExecutionSignal(context);
        signal.throwIfAborted();
        const result = await client.getState();
        signal.throwIfAborted();
        return vacpToolResult(result);
      },
    },
  ];

  for (const action of graph.actions) {
    if (!availability.actions.get(action.name)!.available) continue;
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
      execute: async (args, context) => {
        const signal = webMcpExecutionSignal(context);
        signal.throwIfAborted();
        const { narration: said, ...rest } = args;
        const params = input.wrapped ? args.params : rest;
        const callId = crypto.randomUUID();
        let narration: string;
        try {
          narration = parseVacpNarration(said);
        } catch (error) {
          // Browsers withhold a tool's thrown message from the agent, so the failure is its result.
          return { callId, ok: false, error: { message: (error as Error).message } };
        }
        const result = await client.execute(
          { callId, name: action.name, params },
          { signal, actor: options.actor ?? webMcpAgent, narration },
        );
        signal.throwIfAborted();
        return vacpToolResult(result);
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
