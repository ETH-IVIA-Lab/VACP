import type { VacpCapabilitiesSnapshot, VacpGraph, VacpRef } from '@vacp/core';

/**
 * Mermaid source generation for VACP graphs.
 *
 * The output is stable text for copy/export workflows. Consumers can paste it
 * into Markdown Mermaid blocks, Mermaid Live Editor, or another renderer.
 */

export interface VacpDiagramRenderInput {
  graph: VacpGraph;
}

export interface VacpDiagramRenderOptions {
  direction?: 'LR' | 'TB';
  /** Whether to render actions as separate nodes linked to their targetRef. */
  includeActions?: boolean;
  /** Maximum characters to include for any single label line. */
  maxLabelLength?: number;
}

export function renderVacpDiagramMermaid({
  capabilities,
  options,
}: {
  capabilities: VacpCapabilitiesSnapshot;
  options?: VacpDiagramRenderOptions;
}): string {
  return renderVacpGraphMermaid({ graph: capabilities.graph }, options);
}

function shortRef(ref: VacpRef): string {
  // Labels use a decoded ref suffix so pasted Mermaid stays readable.
  const s = String(ref);
  const hashIdx = s.indexOf('#');
  const clean = hashIdx >= 0 ? s.slice(0, hashIdx) : s;
  const parts = clean
    .split('/')
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
  return parts.slice(-2).join('/');
}

function clampLabel(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}...`;
}

function mermaidIdForIndex(i: number): string {
  return `n${i}`;
}

function actionIdForIndex(i: number): string {
  return `a${i}`;
}

function escapeMermaidLabel(s: string): string {
  // Escape untrusted titles before restoring the HTML tags that Mermaid labels
  // need for line breaks and compact emphasis.
  const BR = '__VACP_BR__';
  const B0 = '__VACP_B0__';
  const B1 = '__VACP_B1__';
  const CODE0 = '__VACP_CODE0__';
  const CODE1 = '__VACP_CODE1__';
  const withPlaceholders = s
    .replaceAll('<br/>', BR)
    .replaceAll('<b>', B0)
    .replaceAll('</b>', B1)
    .replaceAll('<code>', CODE0)
    .replaceAll('</code>', CODE1);

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
    .replaceAll(CODE0, '<code>')
    .replaceAll(CODE1, '</code>')
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"');
}

function escapeMermaidEdgeLabel(s: string): string {
  // Edge labels are not quoted between pipes, so keep their content conservative.
  return s.replaceAll('|', '/').replaceAll('\r', '').replaceAll('\n', ' ');
}

/**
 * Return Mermaid source for a VACP graph.
 */
export function renderVacpGraphMermaid(input: VacpDiagramRenderInput, options?: VacpDiagramRenderOptions): string {
  const direction = options?.direction ?? 'LR';
  const includeActions = options?.includeActions ?? false;
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
      case 'EncodingChannel':
        return '🎛️';
      case 'EncodedField':
        return '🏷️';
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
    lines.push(`${id}["${escapeMermaidLabel(base)}"]`);
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
