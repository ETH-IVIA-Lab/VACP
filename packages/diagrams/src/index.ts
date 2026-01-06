import type { VacpCapabilitiesSnapshot, VacpGraph, VacpRef, VacpStateSnapshot } from '@vacp/core';

/**
 * Diagram rendering (project concepts).
 *
 * VACP is meant to be inspectable and debuggable. A diagram view helps validate:
 * - whether the provider emitted the expected nodes/edges
 * - whether refs are stable and traversable
 * - whether actions target the intended parts of the UI
 *
 * This module provides a pluggable renderer interface:
 * - Mermaid is implemented (text-first and widely supported).
 */

export interface VacpDiagramRenderInput {
  graph: VacpGraph;
  /** Optional state used only to enrich labels for debugging. */
  state?: VacpStateSnapshot;
}

export interface VacpDiagramRenderOptions {
  direction?: 'LR' | 'TB';
  /** Whether to render actions as separate nodes linked to their targetRef. */
  includeActions?: boolean;
  /** Whether to include a compact state preview in node labels when available. */
  includeStatePreview?: boolean;
  /** Maximum characters to include for any single label line. */
  maxLabelLength?: number;
}

export function renderVacpDiagramMermaid({
  capabilities,
  state,
  options,
}: {
  capabilities: VacpCapabilitiesSnapshot;
  state?: VacpStateSnapshot;
  options?: VacpDiagramRenderOptions;
}): string {
  return renderVacpGraphMermaid({ graph: capabilities.graph, state }, options);
}

function shortRef(ref: VacpRef): string {
  // Keep a readable suffix for labels: last path segment if possible.
  const s = String(ref);
  const hashIdx = s.indexOf('#');
  const clean = hashIdx >= 0 ? s.slice(0, hashIdx) : s;
  const parts = clean.split('/').filter(Boolean);
  return parts.slice(-2).join('/');
}

function clampLabel(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

function mermaidIdForIndex(i: number): string {
  return `n${i}`;
}

function actionIdForIndex(i: number): string {
  return `a${i}`;
}

function escapeMermaidLabel(s: string): string {
  // Mermaid node labels are best treated as plain strings. Normalize anything
  // that could accidentally terminate the surrounding syntax.
  return s.replaceAll('\\', '\\\\').replaceAll('\r', '').replaceAll('\n', '\\n').replaceAll('"', '\\"');
}

function toStatePreview(value: unknown, maxLen: number): string | null {
  if (value === undefined) return null;
  try {
    // Mermaid labels don't reliably support escaped quotes inside quoted label
    // strings. Keep previews readable but strictly quote-free.
    const s = JSON.stringify(value).replaceAll('"', "'");
    return clampLabel(s.replaceAll('\n', ' '), maxLen);
  } catch {
    return clampLabel(String(value).replaceAll('"', "'").replaceAll('\n', ' '), maxLen);
  }
}

/**
 * Mermaid renderer (first-class).
 *
 * We keep the diagram text-only and dependency-free: consumers can paste the
 * output into Markdown Mermaid blocks or Mermaid Live Editor.
 */
export function renderVacpGraphMermaid(input: VacpDiagramRenderInput, options?: VacpDiagramRenderOptions): string {
  const direction = options?.direction ?? 'LR';
  const includeActions = options?.includeActions ?? false;
  const includeStatePreview = options?.includeStatePreview ?? false;
  const maxLabelLength = options?.maxLabelLength ?? 80;

  const nodeIndexByRef = new Map<VacpRef, number>();
  input.graph.nodes.forEach((n, i) => nodeIndexByRef.set(n.ref, i));

  const lines: string[] = [];
  lines.push(`flowchart ${direction}`);

  input.graph.nodes.forEach((n, i) => {
    const id = mermaidIdForIndex(i);
    const title = n.title ? clampLabel(n.title, maxLabelLength) : '';
    const ref = clampLabel(shortRef(n.ref), maxLabelLength);
    const base = [n.kind, title, ref].filter(Boolean).join('\\n');
    const statePreview =
      includeStatePreview && input.state
        ? toStatePreview((input.state.state as Record<string, unknown>)[n.ref], maxLabelLength)
        : null;
    const label = statePreview ? `${base}\\nstate=${statePreview}` : base;
    lines.push(`${id}["${escapeMermaidLabel(label)}"]`);
  });

  input.graph.edges.forEach((e) => {
    const fromIdx = nodeIndexByRef.get(e.from);
    const toIdx = nodeIndexByRef.get(e.to);
    if (fromIdx === undefined || toIdx === undefined) return;
    lines.push(`${mermaidIdForIndex(fromIdx)} -->|${e.kind}| ${mermaidIdForIndex(toIdx)}`);
  });

  if (includeActions) {
    input.graph.actions.forEach((a, i) => {
      const aid = actionIdForIndex(i);
      const name = clampLabel(a.name, maxLabelLength);
      lines.push(`${aid}(["${escapeMermaidLabel(`action\\n${name}`)}"])`);
      if (a.targetRef) {
        const targetIdx = nodeIndexByRef.get(a.targetRef);
        if (targetIdx !== undefined) {
          lines.push(`${aid} -.-> ${mermaidIdForIndex(targetIdx)}`);
        }
      }
    });
  }

  return lines.join('\n');
}
