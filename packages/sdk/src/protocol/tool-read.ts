import type { VacpGraph } from './schema';

type GraphRead = { graph: VacpGraph<unknown> };

/**
 * An observation or capabilities snapshot as an agent tool returns it to a model. Source ownership
 * routes execution inside the runtime, so it stays in runtime and inspection reads.
 * `test/fixtures/tool-read.json` holds the same projection for the Python server.
 */
export type VacpToolRead<Read extends GraphRead> = Omit<Read, 'graph'> & { graph: Omit<Read['graph'], 'ownership'> };

function withoutOwnership<Graph extends VacpGraph<unknown>>(graph: Graph): Omit<Graph, 'ownership'> {
  const { ownership: _, ...rest } = graph;
  return rest;
}

export function vacpToolRead<Read extends GraphRead>(read: Read): VacpToolRead<Read> {
  const { graph, ...rest } = read;
  return { ...rest, graph: withoutOwnership(graph) };
}
