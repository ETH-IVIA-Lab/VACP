import type { VacpActionDescriptor, VacpGraph, VacpLayer, VacpNodeKind, VacpRef } from '@vacp/core';
import { VACP_SCHEMA_VERSION } from '@vacp/core';

/**
 * DOM/SVG adapter (concepts).
 *
 * VACP is canonically a graph + actions + snapshots. This module projects that
 * information onto DOM/SVG in a way that is:
 * - easy for agents (and humans) to discover via inspection,
 * - robust across frameworks (React, Svelte, vanilla),
 * - compatible with a DOM-scanning fallback in the MCP server.
 *
 * The preferred runtime integration remains the window bridge (`window.__vacp`),
 * but DOM annotations provide a valuable fallback and debugging surface.
 */
export interface VacpDomAnnotation {
  ref: VacpRef;
  layer: VacpLayer;
  kind: VacpNodeKind;
  description?: string;
  title?: string;
  data?: Record<string, unknown>;
}

export function sanitizeVacpKey(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '');
}

/**
 * Writes VACP context attributes (`data-vacp-*`) onto an element.
 *
 * These attributes are meant to encode *meaning*, not implementation details:
 * - stable identity (`data-vacp-ref`)
 * - semantic classification (`layer`, `kind`)
 * - lightweight summary fields (avoid serializing huge datasets)
 */
export function applyVacpAttributes(element: Element, annotation: VacpDomAnnotation): void {
  element.setAttribute('data-vacp-version', VACP_SCHEMA_VERSION);
  element.setAttribute('data-vacp-ref', annotation.ref);
  element.setAttribute('data-vacp-layer', annotation.layer);
  element.setAttribute('data-vacp-kind', annotation.kind);
  if (annotation.title) element.setAttribute('data-vacp-title', annotation.title);
  if (annotation.description) element.setAttribute('data-vacp-description', annotation.description);
  if (annotation.data) {
    for (const [key, value] of Object.entries(annotation.data)) {
      if (value === undefined || value === null) continue;
      const k = sanitizeVacpKey(key);
      if (!k) continue;
      element.setAttribute(`data-vacp-${k}`, typeof value === 'string' ? value : JSON.stringify(value));
    }
  }
}

export interface VacpInteractionAnnotation {
  targetRef: VacpRef;
  layer: VacpLayer;
  description?: string;
  actions: VacpActionDescriptor[];
}

/**
 * Writes VACP interaction attributes (`data-interaction-vacp-*`) onto an element.
 *
 * This is how an agent can discover *what can be done* in the current state.
 * The authoritative execution path should still validate inputs via a registry
 * (see `@vacp/gateway`), but these attributes act as a discoverable contract.
 */
export function applyVacpInteractionAttributes(element: Element, annotation: VacpInteractionAnnotation): void {
  element.setAttribute('data-interaction-vacp-version', VACP_SCHEMA_VERSION);
  element.setAttribute('data-interaction-vacp-targetref', annotation.targetRef);
  element.setAttribute('data-interaction-vacp-layer', annotation.layer);
  if (annotation.description) element.setAttribute('data-interaction-vacp-description', annotation.description);
  element.setAttribute('data-interaction-vacp-interactions', annotation.actions.map((a) => a.name).join('; '));
  element.setAttribute(
    'data-interaction-vacp-actions',
    JSON.stringify(
      annotation.actions.map((a) => ({
        name: a.name,
        description: a.description,
        parameters: a.parameters,
        targetRef: a.targetRef,
      })),
    ),
  );
}

export const VACP_SVG_METADATA_TYPE = 'application/vacp+json';

/**
 * Embeds the canonical VACP graph into an SVG as `<metadata>`.
 *
 * This supports:
 * - offline capture/debugging ("the SVG contains its own semantics"),
 * - fast extraction without scanning every element,
 * - a DOM-based fallback path when no window bridge is available.
 */
export function embedVacpGraphInSvg(svg: SVGElement, graph: VacpGraph): void {
  // Keep this operation idempotent: re-rendering/patching cycles should not
  // accumulate metadata nodes.
  svg.querySelectorAll(`metadata[type="${VACP_SVG_METADATA_TYPE}"]`).forEach((n) => n.remove());

  const metadata = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'metadata');
  metadata.setAttribute('type', VACP_SVG_METADATA_TYPE);
  metadata.textContent = JSON.stringify(graph);
  svg.appendChild(metadata);
}

/**
 * Reads any embedded VACP graphs from SVG metadata.
 *
 * Note: metadata is an *evidence artifact*; the preferred truth source for
 * dynamic apps is the window bridge (capabilities/state).
 */
export function extractVacpGraphsFromSvg(svg: SVGElement): VacpGraph[] {
  const nodes = svg.querySelectorAll(`metadata[type="${VACP_SVG_METADATA_TYPE}"]`);
  const graphs: VacpGraph[] = [];
  nodes.forEach((n) => {
    const text = n.textContent ?? '';
    if (!text.trim()) return;
    try {
      graphs.push(JSON.parse(text) as VacpGraph);
    } catch {
      // ignore malformed graphs
    }
  });
  return graphs;
}
