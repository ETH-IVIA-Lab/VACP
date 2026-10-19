import { vacpProgressGuidance } from './narration';
import type { VacpCapabilitiesRequest, VacpRef, VacpStateRequest } from './schema';

/**
 * The tools a model uses to reach a page through its bridge, in every transport that offers them:
 * `@ethivia/vacp-agent-ai-sdk` in the page's process and the Python MCP server. Names, input fields,
 * descriptions, and guidance live here once. `test/fixtures/agent-tools.json` holds the same values
 * for the Python server.
 */
export const vacpAgentTools = {
  vacp_observe: {
    description: 'Read the graph, available actions, state, revision, and output freshness in one observation.',
    input: [],
  },
  vacp_capabilities: {
    description:
      'Read the graph and its available actions. Scope the read by refs, prefixes, kinds, or layers once targets are known. Name actions in vacp_execute by graph.actions[].name.',
    input: ['refs', 'prefixes', 'kinds', 'layers', 'includeActions', 'includeEdges', 'includeNodeData'],
  },
  vacp_state: {
    description:
      'Read state keyed by stable refs. Without since it returns the full state and a token. With since set to the token of an earlier read it returns only what changed since then. refs limits the read.',
    input: ['since', 'refs', 'includeSummary'],
  },
  vacp_execute: {
    description:
      'Run one semantic action by its name from the graph, with params matching its parameters schema and a narration sentence for this step. Returns { callId, ok, result, error }.',
    input: ['name', 'params', 'narration', 'call_id'],
  },
  vacp_progress: { description: vacpProgressGuidance, input: ['message', 'done'] },
} as const;

/** How to use the tools economically. Each transport gives it to the model with the tools. */
export const vacpAgentToolGuidance = [
  'Read vacp_observe once at the start of a request. Only the actions available now are disclosed.',
  'Observe again only when the available actions may have changed, such as after loading a dataset, or when vacp_execute reports an unknown or unavailable action.',
  'Read what an action changed from its result and vacp_state. After actions, prefer vacp_state with since set to the token of the previous read, and read once without since when the lineage is unclear.',
  'Scope vacp_capabilities and vacp_state by refs once targets are known. Omit scope fields for an unscoped read, which leaves out node data unless includeNodeData is true.',
  'Call vacp_progress once before the first action with one plain sentence for the person, give every vacp_execute its own narration, and close the task with vacp_progress and done set to true.',
].join(' ');

/** A bare `vacp://` scope names everything, which is an unscoped read. */
function scope(refs: readonly VacpRef[] | undefined): VacpRef[] | undefined {
  const scoped = refs?.filter((ref) => ref !== 'vacp://');
  return scoped?.length ? scoped : undefined;
}

/** The capabilities request a tool input asks for. An unscoped read leaves out node data unless asked. */
export function vacpToolCapabilitiesRequest({
  refs,
  prefixes,
  ...rest
}: VacpCapabilitiesRequest = {}): VacpCapabilitiesRequest {
  const request: VacpCapabilitiesRequest = { ...rest };
  const scopedRefs = scope(refs);
  const scopedPrefixes = scope(prefixes);
  if (scopedRefs) request.refs = scopedRefs;
  if (scopedPrefixes) request.prefixes = scopedPrefixes;
  if (!scopedRefs && !scopedPrefixes && !rest.kinds?.length && !rest.layers?.length) request.includeNodeData ??= false;
  return request;
}

/** The state request a tool input asks for. */
export function vacpToolStateRequest({ refs, ...rest }: VacpStateRequest = {}): VacpStateRequest {
  const request: VacpStateRequest = { ...rest };
  const scopedRefs = scope(refs);
  if (scopedRefs) request.refs = scopedRefs;
  return request;
}
