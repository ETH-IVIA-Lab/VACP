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
  // We want readable multi-line labels in Mermaid. Mermaid flowcharts support
  // HTML labels (including `<br/>`) when `htmlLabels` is enabled.
  //
  // We also want this renderer to be safe with untrusted titles: escape HTML by
  // default and explicitly re-allow only a tiny whitelist used for formatting.
  const BR = '__VACP_BR__';
  const B0 = '__VACP_B0__';
  const B1 = '__VACP_B1__';
  const withPlaceholders = s.replaceAll('<br/>', BR).replaceAll('<b>', B0).replaceAll('</b>', B1);

  const escapedHtml = withPlaceholders
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\r', '')
    .replaceAll('\n', ' ');

  // Restore line breaks and escape Mermaid string delimiters.
  return escapedHtml
    .replaceAll(BR, '<br/>')
    .replaceAll(B0, '<b>')
    .replaceAll(B1, '</b>')
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"');
}

function escapeMermaidEdgeLabel(s: string): string {
  // Edge labels are *not* quoted (they sit between `|...|`), so keep them very
  // conservative to avoid parse errors.
  return s.replaceAll('|', '/').replaceAll('\r', '').replaceAll('\n', ' ');
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

  const iconForKind = (kind: string): string => {
    switch (kind) {
      case 'View':
        return '🧭';
      case 'Visualization':
        return '📊';
      case 'Mark':
        return '✳️';
      case 'Selection':
        return '🎯';
      case 'Param':
        return '🎚️';
      case 'Widget':
        return '🔧';
      case 'DataHandle':
        return '🗄️';
      case 'InteractionTarget':
        return '🖱️';
      default:
        return '🧩';
    }
  };

  input.graph.nodes.forEach((n, i) => {
    const id = mermaidIdForIndex(i);
    const title = n.title ? clampLabel(n.title, maxLabelLength) : '';
    const ref = clampLabel(shortRef(n.ref), maxLabelLength);
    const base = [`${iconForKind(n.kind)} <b>${n.kind}</b>`, title ? `<b>${title}</b>` : '', ref ? `🔗 ${ref}` : '']
      .filter(Boolean)
      .join('<br/>');
    const statePreview =
      includeStatePreview && input.state
        ? toStatePreview((input.state.state as Record<string, unknown>)[n.ref], maxLabelLength)
        : null;
    const label = statePreview ? `${base}<br/>🧾 state=${statePreview}` : base;
    lines.push(`${id}["${escapeMermaidLabel(label)}"]`);
  });

  input.graph.edges.forEach((e) => {
    const fromIdx = nodeIndexByRef.get(e.from);
    const toIdx = nodeIndexByRef.get(e.to);
    if (fromIdx === undefined || toIdx === undefined) return;
    const label = escapeMermaidEdgeLabel(clampLabel(e.kind, maxLabelLength));
    lines.push(`${mermaidIdForIndex(fromIdx)} -->|${label}| ${mermaidIdForIndex(toIdx)}`);
  });

  if (includeActions) {
    input.graph.actions.forEach((a, i) => {
      const aid = actionIdForIndex(i);
      const name = clampLabel(a.name, maxLabelLength);
      lines.push(`${aid}(["${escapeMermaidLabel(`⚡ <b>action</b><br/><b>${name}</b>`)}"])`);
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
