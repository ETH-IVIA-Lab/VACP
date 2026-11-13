import type { WebMCP } from 'webmcp-types';
import {
  fnv1a64Hex,
  parseVacpNarration,
  primaryOperationRef,
  resolveVacpAvailability,
  vacpAgentActor,
  vacpNarrationGuidance,
  vacpToolCapabilitiesRequest,
  vacpToolRead,
  vacpToolResult,
  vacpToolStateRequest,
  VACP_NARRATION_MAX_LENGTH,
  vacpAgentTools,
  vacpWebMcpReadDescriptions,
  type VacpActionDescriptor,
  type VacpGraph,
} from '../protocol';
import { parseCapabilitiesRequest, parseStateRequest } from '../protocol/validation';
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

/** Model APIs accept tool names of this shape, so every registered name has it. */
const toolName = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The tool name of an action: the namespace and the action name joined by `_`, with each `.` as `_`.
 * A name longer than 64 characters keeps its start and ends with a hash of the whole name.
 */
function actionToolName(namespace: string, action: string): string {
  const name = `${namespace}_${action.replaceAll('.', '_')}`;
  if (name.length <= 64) return name;
  return `${name.slice(0, 55)}_${fnv1a64Hex(name).slice(0, 8)}`;
}

const refs = { type: 'array', items: { type: 'string', pattern: '^vacp://' } };
const names = { type: 'array', items: { type: 'string', pattern: '\\S' } };

/** The `vacp_capabilities` fields, without `includeActions`: each available action is its own tool. */
const capabilitiesInput = {
  type: 'object',
  properties: {
    refs,
    prefixes: refs,
    kinds: names,
    layers: names,
    includeEdges: { type: 'boolean' },
    includeNodeData: { type: 'boolean' },
  },
  additionalProperties: false,
};

const stateInput = {
  type: 'object',
  properties: { since: { type: 'string', pattern: '\\S' }, refs, includeSummary: { type: 'boolean' } },
  additionalProperties: false,
};

/**
 * Every action tool asks for the step's own sentence in `narration`, beside the action's own
 * parameters. Whole-object constraints, references, scalar schemas, and narration name collisions
 * keep their action schema under `params`.
 */
function actionInput(action: VacpActionDescriptor, name: string) {
  const schema = action.parameters ? copySchema(action.parameters) : undefined;
  const properties = schema?.properties;
  const collides = !!properties && typeof properties === 'object' && Object.hasOwn(properties, 'narration');
  const safeKeys = new Set([
    'type',
    'properties',
    'required',
    'title',
    'description',
    'default',
    'examples',
    'deprecated',
    'readOnly',
    'writeOnly',
    '$comment',
    '$schema',
    '$id',
    '$anchor',
    '$dynamicAnchor',
    '$defs',
    'definitions',
  ]);
  const references = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, nested]) => key === '$ref' || key === '$dynamicRef' || references(nested));
  };
  const flatten =
    schema?.type === 'object' &&
    !collides &&
    !(Array.isArray(schema.required) && schema.required.includes('narration')) &&
    Object.keys(schema).every((key) => safeKeys.has(key)) &&
    !references(schema);
  if (schema === undefined || flatten) {
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
  resource.$id ??= `urn:vacp:webmcp:${encodeURIComponent(name)}`;
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
 * Project a VACP graph into executable WebMCP tools without accessing the browser. The reads carry
 * the names of `vacpAgentTools` under `namespace`, and each available action is a tool named by
 * `actionToolName`. Every read and action result reaches the model within the limits of
 * `vacpToolResult`.
 */
export function compileVacpWebMcpTools(
  graph: VacpGraph,
  client: VacpWebMcpClient,
  options: Pick<VacpWebMcpOptions, 'actor' | 'namespace'> = {},
): WebMCP.ModelContextTool[] {
  const namespace = options.namespace ?? 'vacp';
  const actor = options.actor ?? vacpAgentActor;
  const availability = resolveVacpAvailability(graph);
  const nodes = new Map(graph.nodes.map((node) => [node.ref, node]));
  const tools: WebMCP.ModelContextTool[] = [
    {
      name: `${namespace}_observe`,
      title: vacpAgentTools.vacp_observe.title,
      description: vacpWebMcpReadDescriptions.vacp_observe,
      annotations: { readOnlyHint: true },
      execute: async (_input, context) => {
        context?.signal?.throwIfAborted();
        const result = await client.observe();
        context?.signal?.throwIfAborted();
        return vacpToolResult(entityRead(result));
      },
    },
    {
      name: `${namespace}_capabilities`,
      title: vacpAgentTools.vacp_capabilities.title,
      description: vacpWebMcpReadDescriptions.vacp_capabilities,
      inputSchema: capabilitiesInput,
      annotations: { readOnlyHint: true },
      execute: async (input, context) => {
        context?.signal?.throwIfAborted();
        const { includeActions: _, ...request } = parseCapabilitiesRequest(input);
        const result = await client.getCapabilities(vacpToolCapabilitiesRequest(request));
        context?.signal?.throwIfAborted();
        return vacpToolResult(entityRead(result));
      },
    },
    {
      name: `${namespace}_state`,
      title: vacpAgentTools.vacp_state.title,
      description: vacpAgentTools.vacp_state.description,
      inputSchema: stateInput,
      annotations: { readOnlyHint: true },
      execute: async (input, context) => {
        context?.signal?.throwIfAborted();
        const result = await client.getState(vacpToolStateRequest(parseStateRequest(input)));
        context?.signal?.throwIfAborted();
        return vacpToolResult(result);
      },
    },
  ];

  for (const action of graph.actions) {
    if (!availability.actions.get(action.name)!.available) continue;
    const name = actionToolName(namespace, action.name);
    const primaryRef = primaryOperationRef(action);
    const target = primaryRef ? nodes.get(primaryRef) : undefined;
    const context = target
      ? `\nTarget: ${target.title ?? target.ref} (${target.kind}, ${target.layer}). VACP ref: ${target.ref}.`
      : primaryRef
        ? `\nVACP target: ${primaryRef}.`
        : '';
    const input = actionInput(action, name);
    tools.push({
      name,
      title: action.title,
      description: `${action.description}${context}`,
      inputSchema: input.schema,
      execute: async (args, context) => {
        const signal = context?.signal;
        signal?.throwIfAborted();
        const { narration: said, ...rest } = args;
        const params = input.wrapped ? args.params : rest;
        let narration: string;
        try {
          narration = parseVacpNarration(said);
        } catch (error) {
          // Browsers withhold a tool's thrown message from the agent, so the failure is its result.
          return { ok: false, error: { message: error instanceof Error ? error.message : String(error) } };
        }
        // Execution owns its outcome: a result that arrived stays the answer, even if the caller left since.
        return vacpToolResult(await client.execute({ name: action.name, params }, { signal, actor, narration }));
      },
    });
  }

  // The progress tool joins at installation under `${namespace}_progress`.
  const names = new Set([`${namespace}_progress`]);
  for (const tool of tools) {
    if (!toolName.test(tool.name)) {
      throw new TypeError(
        `Invalid WebMCP tool name: ${tool.name}. Name the action with A-Z, a-z, 0-9, _, ., or -, and the namespace with A-Z, a-z, 0-9, _, or - in at most 51 characters.`,
      );
    }
    if (names.has(tool.name)) throw new TypeError(`Duplicate WebMCP tool name: ${tool.name}`);
    if (!tool.description.trim()) throw new TypeError(`WebMCP tool ${tool.name} needs a description`);
    names.add(tool.name);
  }
  return tools;
}
