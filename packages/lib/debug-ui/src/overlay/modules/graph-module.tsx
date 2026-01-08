import type { VacpNode, VacpRef, VacpRuntimeSnapshot } from '@vacp/core';
import { ArrowLeftRight, ArrowUpDown, ClipboardCopy, XCircle, Zap } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { VacpDiagramRenderOptions } from '@vacp/diagrams';
import { renderVacpDiagramMermaid } from '@vacp/diagrams';

import { renderMermaidToHost } from '@vacp/debug-ui/mermaid-renderer';
import { useVacpDebugUiStore } from '@vacp/debug-ui/overlay/debug-store';
import { IconButton } from '@vacp/debug-ui/overlay/icon-button';
import { Card, CardDescription, CardHeader, CardTitle } from '@vacp/debug-ui/ui/components/ui/card';

import type { VacpDebugModuleProps } from './module-types';

type SelectedGraphItem =
  | { kind: 'node'; mermaidId: string; index: number }
  | { kind: 'action'; mermaidId: string; index: number }
  | null;

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function shortRef(ref: VacpRef): string {
  const s = String(ref);
  const hashIdx = s.indexOf('#');
  const clean = hashIdx >= 0 ? s.slice(0, hashIdx) : s;
  const parts = clean.split('/').filter(Boolean);
  return parts.slice(-2).join('/');
}

function parseMermaidNodeId(svgNodeId: string | null): { mermaidId: string; index: number; kind: 'node' | 'action' } | null {
  if (!svgNodeId) return null;
  const m = svgNodeId.match(/flowchart-([na]\d+)-/);
  if (!m) return null;
  const mermaidId = m[1]!;
  const kind = mermaidId.startsWith('a') ? 'action' : 'node';
  const n = Number.parseInt(mermaidId.slice(1), 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return { mermaidId, index: n, kind };
}

function updateSelectedHighlight(host: HTMLElement, sel: SelectedGraphItem) {
  const svg = host.querySelector('svg');
  if (!svg) return;
  svg.querySelectorAll('g.node.vacp-selected').forEach((g) => g.classList.remove('vacp-selected'));
  if (!sel) return;
  const prefix = `flowchart-${sel.mermaidId}-`;
  const target = Array.from(svg.querySelectorAll('g.node')).find((g) => (g.getAttribute('id') ?? '').startsWith(prefix));
  if (target) target.classList.add('vacp-selected');
}

function buildInspectorJson(runtime: VacpRuntimeSnapshot, sel: SelectedGraphItem): string {
  if (!sel) return '';
  if (sel.kind === 'action') {
    const a = runtime.currentCapabilities.graph.actions?.[sel.index];
    return safeJson(
      a
        ? { kind: 'action', name: a.name, description: a.description ?? null, targetRef: a.targetRef ?? null, parameters: a.parameters ?? {} }
        : { error: 'Unknown action index', index: sel.index },
    );
  }

  const node = runtime.currentCapabilities.graph.nodes?.[sel.index] as VacpNode | undefined;
  if (!node) return safeJson({ error: 'Unknown node index', index: sel.index });
  const stateValue = (runtime.currentState.state as Record<string, unknown>)[node.ref];
  const targeting = (runtime.currentCapabilities.graph.actions ?? []).filter((a) => a.targetRef === node.ref);
  return safeJson({
    kind: 'node',
    ref: node.ref,
    shortRef: shortRef(node.ref),
    nodeKind: node.kind,
    title: node.title ?? null,
    state: stateValue ?? null,
    actions: targeting.map((a) => a.name),
  });
}

export function GraphModule(props: VacpDebugModuleProps): ReactElement {
  const includeActionsDefault = useVacpDebugUiStore((s) => s.includeActionsDefault);
  const [options, setOptions] = useState<Required<Pick<VacpDiagramRenderOptions, 'direction' | 'includeActions'>>>({
    direction: 'TB',
    includeActions: includeActionsDefault,
  });
  const [selected, setSelected] = useState<SelectedGraphItem>(null);
  const [stale, setStale] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  const diagramHostRef = useRef<HTMLDivElement | null>(null);

  const mermaidText = useMemo(() => {
    return renderVacpDiagramMermaid({ capabilities: props.runtime.currentCapabilities, options });
  }, [props.runtime.currentCapabilities, options]);

  const inspectorJson = useMemo(() => buildInspectorJson(props.runtime, selected), [props.runtime, selected]);

  useEffect(() => {
    const host = diagramHostRef.current;
    if (!host) return;

    let cancelled = false;
    setStale(true);
    setRenderError(null);

    const t = window.setTimeout(() => {
      void (async () => {
        try {
          await renderMermaidToHost(host, mermaidText);
          if (cancelled) return;
          updateSelectedHighlight(host, selected);
        } catch (err) {
          if (cancelled) return;
          setRenderError(String(err));
        } finally {
          if (!cancelled) setStale(false);
        }
      })();
    }, 140);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [mermaidText]);

  useEffect(() => {
    const host = diagramHostRef.current;
    if (!host) return;
    updateSelectedHighlight(host, selected);
  }, [selected]);

  useEffect(() => {
    const host = diagramHostRef.current;
    if (!host) return;
    const onClick = (ev: MouseEvent) => {
      const target = ev.target;
      if (!(target instanceof Element)) return;
      const g = target.closest?.('g.node');
      if (!g) return;
      const parsed = parseMermaidNodeId(g.getAttribute('id'));
      if (!parsed) return;
      setSelected(
        parsed.kind === 'node'
          ? { kind: 'node', mermaidId: parsed.mermaidId, index: parsed.index }
          : { kind: 'action', mermaidId: parsed.mermaidId, index: parsed.index },
      );
    };
    host.addEventListener('click', onClick);
    return () => host.removeEventListener('click', onClick);
  }, []);

  const copy = async (text: string) => {
    const t = text ?? '';
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(t).catch(() => {});
      return;
    }
    const el = document.createElement('textarea');
    el.value = t;
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    document.body.append(el);
    el.select();
    try {
      document.execCommand('copy');
    } catch {
      // ignore
    } finally {
      el.remove();
    }
  };

  return (
    <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[1fr_420px]" data-vacp-graph="1">
      <Card className="flex min-h-0 flex-col">
        <CardHeader>
          <div>
            <CardTitle>Graph</CardTitle>
            <CardDescription>
              Click nodes to inspect their state. {renderError ? <span className="text-rose-100/80">({renderError})</span> : null}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <IconButton
              icon={options.direction === 'LR' ? <ArrowLeftRight className="h-4 w-4 text-slate-100/90" /> : <ArrowUpDown className="h-4 w-4 text-slate-100/90" />}
              label="Toggle direction"
              title="Toggle diagram direction (left-to-right vs top-to-bottom)."
              onClick={() => setOptions((o) => ({ ...o, direction: o.direction === 'LR' ? 'TB' : 'LR' }))}
            />
            <IconButton
              icon={<Zap className="h-4 w-4 text-slate-100/90" />}
              label={options.includeActions ? 'Hide actions' : 'Show actions'}
              title="Show semantic actions as nodes in the diagram."
              pressed={options.includeActions}
              onClick={() => setOptions((o) => ({ ...o, includeActions: !o.includeActions }))}
            />
            <IconButton
              icon={<ClipboardCopy className="h-4 w-4 text-slate-100/90" />}
              label="Copy Mermaid"
              title="Copy the Mermaid source for this diagram."
              onClick={() => void copy(mermaidText)}
            />
          </div>
        </CardHeader>

        <div className="min-h-0 flex-1">
          <div
            ref={diagramHostRef}
            className="vacp-debug-ui-diagram h-full w-full min-h-0 overflow-hidden rounded-lg border border-white/10 bg-black/20"
            data-stale={stale ? '1' : '0'}
          />
        </div>
      </Card>

      <Card className="flex min-h-0 flex-col">
        <CardHeader>
          <div>
            <CardTitle>Inspect</CardTitle>
            <CardDescription>
              {selected
                ? selected.kind === 'action'
                  ? `Action #${selected.index}`
                  : `Node #${selected.index}`
                : 'Select a node to see its full JSON.'}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <IconButton
              icon={<XCircle className="h-4 w-4 text-slate-100/90" />}
              label="Clear selection"
              title="Clear the selected node/action."
              onClick={() => setSelected(null)}
            />
            <IconButton
              icon={<ClipboardCopy className="h-4 w-4 text-slate-100/90" />}
              label="Copy JSON"
              title="Copy the inspected JSON to clipboard."
              onClick={() => void copy(inspectorJson)}
            />
          </div>
        </CardHeader>

        <pre className="min-h-0 flex-1 overflow-auto rounded-lg border border-white/10 bg-black/20 p-3 text-[12px] leading-5 text-slate-100/85">
          {selected ? inspectorJson : ''}
        </pre>
      </Card>
    </div>
  );
}
