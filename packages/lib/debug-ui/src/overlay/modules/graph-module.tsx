import type { VacpNode, VacpRef, VacpRuntimeSnapshot } from '@vacp/core';
import { ArrowLeftRight, ArrowUpDown, ClipboardCopy, PanelRightClose, PanelRightOpen, XCircle, Zap } from 'lucide-react';
import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { VacpDiagramRenderOptions } from '@vacp/diagrams';
import { renderVacpDiagramMermaid } from '@vacp/diagrams';

import { renderMermaidToHost } from '@vacp/debug-ui/mermaid-renderer';
import { useVacpDebugUiStore } from '@vacp/debug-ui/overlay/debug-store';
import { IconButton } from '@vacp/debug-ui/overlay/icon-button';
import { useElementSize } from '@vacp/debug-ui/overlay/hooks/use-element-size';
import { Card, CardDescription, CardHeader, CardTitle } from '@vacp/debug-ui/ui/components/ui/card';
import { JsonViewer } from '@vacp/debug-ui/ui/components/ui/json-viewer';
import { copyTextToClipboard } from '@vacp/debug-ui/ui/lib/clipboard';
import { cn } from '@vacp/debug-ui/ui/lib/utils';

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
  const parts = clean.split('/').filter(Boolean).filter((p) => p !== 'vacp:');
  return parts.slice(-3).join('/');
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

function buildInspectorValue(runtime: VacpRuntimeSnapshot, sel: SelectedGraphItem): unknown {
  if (!sel) return null;
  if (sel.kind === 'action') {
    const a = runtime.currentCapabilities.graph.actions?.[sel.index];
    return a
      ? { kind: 'action', name: a.name, description: a.description ?? null, targetRef: a.targetRef ?? null, parameters: a.parameters ?? {} }
      : { error: 'Unknown action index', index: sel.index };
  }

  const node = runtime.currentCapabilities.graph.nodes?.[sel.index] as VacpNode | undefined;
  if (!node) return { error: 'Unknown node index', index: sel.index };
  const stateValue = (runtime.currentState.state as Record<string, unknown>)[node.ref];
  const targeting = (runtime.currentCapabilities.graph.actions ?? []).filter((a) => a.targetRef === node.ref);
  return {
    kind: 'node',
    ref: node.ref,
    shortRef: shortRef(node.ref),
    nodeKind: node.kind,
    title: node.title ?? null,
    description: node.description ?? null,
    data: node.data ?? null,
    state: stateValue ?? null,
    actions: targeting.map((a) => a.name),
  };
}

export function GraphModule(props: VacpDebugModuleProps): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rootSize = useElementSize(rootRef);
  const compactControls = rootSize.width < 520;
  const dense = rootSize.width < 520 || rootSize.height < 360;
  const iconButtonSize = 'iconSm';
  const includeActionsDefault = useVacpDebugUiStore((s) => s.includeActionsDefault);
  const inspectOpen = useVacpDebugUiStore((s) => s.graphInspectOpen);
  const setInspectOpen = useVacpDebugUiStore((s) => s.setGraphInspectOpen);
  const effectiveInspectOpen = inspectOpen && !dense;
  const showSideBySide = effectiveInspectOpen && rootSize.width >= 900;
  const [options, setOptions] = useState<Required<Pick<VacpDiagramRenderOptions, 'direction' | 'includeActions'>>>({
    direction: 'LR',
    includeActions: includeActionsDefault,
  });
  const [selected, setSelected] = useState<SelectedGraphItem>(null);
  const [stale, setStale] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  const diagramHostRef = useRef<HTMLDivElement | null>(null);

  const mermaidText = useMemo(() => {
    return renderVacpDiagramMermaid({ capabilities: props.runtime.currentCapabilities, options });
  }, [props.runtime.currentCapabilities, options]);

  const inspectorValue = useMemo(() => buildInspectorValue(props.runtime, selected), [props.runtime, selected]);
  const inspectorText = useMemo(() => (selected ? safeJson(inspectorValue) : ''), [inspectorValue, selected]);

  useEffect(() => {
    if (!dense || !inspectOpen) return;
    setInspectOpen(false);
  }, [dense, inspectOpen, setInspectOpen]);

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
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
      const target = ev.target;
      if (!(target instanceof Element)) return;
      const g = target.closest?.('g.node');
      if (!g) return;
      const parsed = parseMermaidNodeId(g.getAttribute('id'));
      if (!parsed) return;
      ev.preventDefault();
      setSelected(
        parsed.kind === 'node'
          ? { kind: 'node', mermaidId: parsed.mermaidId, index: parsed.index }
          : { kind: 'action', mermaidId: parsed.mermaidId, index: parsed.index },
      );
    };
    host.addEventListener('click', onClick);
    host.addEventListener('keydown', onKeyDown);
    return () => {
      host.removeEventListener('click', onClick);
      host.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className={cn(
        'h-full min-h-0',
        dense ? 'gap-2' : 'gap-3',
        showSideBySide ? 'grid grid-cols-[minmax(0,1fr)_minmax(320px,420px)]' : 'flex flex-col',
      )}
      data-vacp-graph="1"
      data-vacp-direction={options.direction}
    >
      <Card className={cn('flex min-h-0 flex-1 flex-col', dense && 'p-2')}>
        <CardHeader className={cn(compactControls && 'flex-col items-stretch gap-2')}>
          <div className="min-w-0">
            <CardTitle>Graph</CardTitle>
            <CardDescription>
              Click nodes to inspect their state. {renderError ? <span className="text-rose-100/80">({renderError})</span> : null}
            </CardDescription>
          </div>
          <div
            className={cn(
              'flex items-center gap-2',
              compactControls
                ? 'w-full flex-nowrap justify-start overflow-x-auto gap-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
                : 'shrink-0 flex-wrap justify-end',
            )}
          >
            <IconButton
              icon={options.direction === 'LR' ? <ArrowLeftRight className="h-4 w-4 text-slate-100/90" /> : <ArrowUpDown className="h-4 w-4 text-slate-100/90" />}
              label="Toggle direction"
              title="Toggle diagram direction (left-to-right vs top-to-bottom)."
              size={iconButtonSize}
              onClick={() => setOptions((o) => ({ ...o, direction: o.direction === 'LR' ? 'TB' : 'LR' }))}
            />
            <IconButton
              icon={<Zap className="h-4 w-4 text-slate-100/90" />}
              label={options.includeActions ? 'Hide actions' : 'Show actions'}
              title="Show semantic actions as nodes in the diagram."
              pressed={options.includeActions}
              size={iconButtonSize}
              onClick={() => setOptions((o) => ({ ...o, includeActions: !o.includeActions }))}
            />
            <IconButton
              icon={<ClipboardCopy className="h-4 w-4 text-slate-100/90" />}
              label="Copy Mermaid"
              title="Copy the Mermaid source for this diagram."
              size={iconButtonSize}
              onClick={() => void copyTextToClipboard(mermaidText)}
            />
            <IconButton
              icon={inspectOpen ? <PanelRightClose className="h-4 w-4 text-slate-100/90" /> : <PanelRightOpen className="h-4 w-4 text-slate-100/90" />}
              label={inspectOpen ? 'Hide inspect pane' : 'Show inspect pane'}
              title={inspectOpen ? 'Hide the Inspect pane to give the diagram more space.' : 'Show the Inspect pane.'}
              pressed={effectiveInspectOpen}
              size={iconButtonSize}
              onClick={() => setInspectOpen(!inspectOpen)}
            />
          </div>
        </CardHeader>

        <div className={cn('min-h-0 flex-1', dense ? 'mt-2' : 'mt-3')}>
          <div
            ref={diagramHostRef}
            className="vacp-debug-ui-diagram h-full w-full min-h-0 overflow-hidden rounded-lg border border-white/10 bg-black/20"
            data-stale={stale ? '1' : '0'}
          />
        </div>
      </Card>

      {effectiveInspectOpen ? (
        <Card className={cn('flex min-h-0 flex-col', !showSideBySide && 'max-h-[45%]', dense && 'p-2')}>
          <CardHeader className={cn(compactControls && 'flex-col items-stretch gap-2')}>
            <div className="min-w-0">
              <CardTitle>Inspect</CardTitle>
              <CardDescription>
                {selected
                  ? selected.kind === 'action'
                    ? `Action #${selected.index}`
                    : `Node #${selected.index}`
                  : 'Select a node to see its full JSON.'}
              </CardDescription>
            </div>
            <div
              className={cn(
                'flex items-center gap-2',
                compactControls
                  ? 'w-full flex-nowrap justify-start overflow-x-auto gap-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
                  : 'shrink-0',
              )}
            >
              <IconButton
                icon={<XCircle className="h-4 w-4 text-slate-100/90" />}
                label="Clear selection"
                title="Clear the selected node/action."
                size={iconButtonSize}
                onClick={() => setSelected(null)}
              />
              <IconButton
                icon={<ClipboardCopy className="h-4 w-4 text-slate-100/90" />}
                label="Copy JSON"
                title="Copy the inspected JSON to clipboard."
                size={iconButtonSize}
                onClick={() => void copyTextToClipboard(inspectorText)}
              />
            </div>
          </CardHeader>

          <JsonViewer value={selected ? inspectorValue : null} className={cn('flex-1', dense && 'p-2')} />
        </Card>
      ) : null}
    </div>
  );
}
