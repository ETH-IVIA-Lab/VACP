import type { VacpNodeKind, VacpRef } from '@vacp/protocol';
import {
  ArrowLeftRight,
  ArrowUpDown,
  Check,
  ClipboardCopy,
  Filter,
  LocateFixed,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Search,
  Workflow,
  XCircle,
  Zap,
} from 'lucide-react';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { renderVacpDiagramMermaid } from '@vacp/diagram-mermaid';

import { INSPECTOR_PANEL_BREAKPOINTS, isDenseInspectorPanel } from '@vacp/inspector/overlay/inspector-breakpoints';
import { useVacpInspectorStore } from '@vacp/inspector/overlay/inspector-store';
import { IconButton } from '@vacp/inspector/overlay/icon-button';
import { useElementSize } from '@vacp/inspector/overlay/hooks/use-element-size';
import { Input } from '@vacp/inspector/ui/components/ui/input';
import { JsonViewer } from '@vacp/inspector/ui/components/ui/json-viewer';
import { copyTextToClipboard } from '@vacp/inspector/ui/lib/clipboard';
import { cn } from '@vacp/inspector/ui/lib/utils';

import { ModuleHeader, ModulePane, ModuleRoot } from './module-layout';
import type { VacpInspectorModuleProps } from './module-types';
import { VacpGraphFlow } from './graph/graph-flow';
import {
  buildInspectorValue,
  buildVacpFlowGraph,
  actionId,
  filterVacpGraph,
  nodeId,
  nodeKindCounts,
  safeJson,
  shortRef,
} from './graph/graph-model';
import { useVacpGraphUiStore } from './graph/graph-state';
import type { SelectedGraphItem } from './graph/graph-types';

function selectedDescription(selected: SelectedGraphItem): string {
  if (!selected) return 'Select a node or action to see its full JSON.';

  if (selected.kind === 'action') return `Action ${selected.name}`;

  return `Node ${shortRef(selected.ref)}`;
}

export function GraphModule(props: VacpInspectorModuleProps): ReactElement {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rootSize = useElementSize(rootRef);
  const compactControls = rootSize.width < INSPECTOR_PANEL_BREAKPOINTS.compactControls;
  const dense = isDenseInspectorPanel(rootSize.width, rootSize.height);
  const boundWide = rootSize.width >= INSPECTOR_PANEL_BREAKPOINTS.splitPane;
  const iconButtonSize = 'iconSm';
  const includeActionsDefault = useVacpInspectorStore((s) => s.includeActionsDefault);
  const inspectOpen = useVacpInspectorStore((s) => s.graphInspectOpen);
  const setInspectOpen = useVacpInspectorStore((s) => s.setGraphInspectOpen);
  const direction = useVacpGraphUiStore((s) => s.direction);
  const includeActionsOverride = useVacpGraphUiStore((s) => s.includeActionsOverride);
  const selected = useVacpGraphUiStore((s) => s.selected);
  const collapsedRefs = useVacpGraphUiStore((s) => s.collapsedRefs);
  const toggleDirection = useVacpGraphUiStore((s) => s.toggleDirection);
  const toggleIncludeActions = useVacpGraphUiStore((s) => s.toggleIncludeActions);
  const selectGraphItem = useVacpGraphUiStore((s) => s.selectGraphItem);
  const pruneSelectedNodeIds = useVacpGraphUiStore((s) => s.pruneSelectedNodeIds);
  const pruneCollapsedRefs = useVacpGraphUiStore((s) => s.pruneCollapsedRefs);
  const toggleCollapsedRef = useVacpGraphUiStore((s) => s.toggleCollapsedRef);
  const effectiveInspectOpen = inspectOpen && selected !== null;
  const showSideBySide = effectiveInspectOpen && rootSize.width >= INSPECTOR_PANEL_BREAKPOINTS.splitPane;
  const [mermaidCopied, setMermaidCopied] = useState(false);
  const [query, setQuery] = useState('');
  const [activeKinds, setActiveKinds] = useState<VacpNodeKind[]>([]);
  const [focusSelection, setFocusSelection] = useState(false);

  const graph = props.runtime.currentCapabilities.graph;
  const includeActions = includeActionsOverride ?? includeActionsDefault;
  const activeKindSet = useMemo(() => new Set(activeKinds), [activeKinds]);

  const filteredGraph = useMemo(
    () =>
      filterVacpGraph(graph, {
        query,
        nodeKinds: activeKindSet,
        focus: focusSelection ? selected : null,
      }),
    [activeKindSet, focusSelection, graph, query, selected],
  );

  const kindCounts = useMemo(() => nodeKindCounts(graph), [graph]);

  const layerSummary = useMemo(() => {
    const counts = new Map<string, number>();

    for (const node of filteredGraph.nodes) counts.set(node.layer, (counts.get(node.layer) ?? 0) + 1);

    return [...counts.entries()].map(([layer, count]) => `${layer.replace('Layer', '')} ${count}`).join(' / ');
  }, [filteredGraph.nodes]);

  const filtersActive = query.trim().length > 0 || activeKinds.length > 0 || focusSelection;

  const toggleCollapse = useCallback((ref: VacpRef) => toggleCollapsedRef(graph, ref), [graph, toggleCollapsedRef]);

  const flow = useMemo(
    () =>
      buildVacpFlowGraph({
        graph: filteredGraph,
        direction,
        includeActions,
        collapsedRefs,
        selected,
        onToggleCollapse: toggleCollapse,
        onSelect: selectGraphItem,
      }),
    [collapsedRefs, direction, filteredGraph, includeActions, selectGraphItem, selected, toggleCollapse],
  );

  const mermaidText = useMemo(
    () =>
      renderVacpDiagramMermaid({
        capabilities: { ...props.runtime.currentCapabilities, graph: filteredGraph },
        options: { direction, includeActions },
      }),
    [direction, filteredGraph, includeActions, props.runtime.currentCapabilities],
  );

  const inspectorValue = useMemo(() => buildInspectorValue(props.runtime, selected), [props.runtime, selected]);
  const inspectorText = useMemo(() => (selected ? safeJson(inspectorValue) : ''), [inspectorValue, selected]);

  const copyMermaid = useCallback(async () => {
    await copyTextToClipboard(mermaidText);
    setMermaidCopied(true);
  }, [mermaidText]);

  useEffect(() => {
    if (!mermaidCopied) return;
    const id = window.setTimeout(() => setMermaidCopied(false), 1600);

    return () => window.clearTimeout(id);
  }, [mermaidCopied]);

  useEffect(() => {
    pruneCollapsedRefs(graph);
  }, [graph, pruneCollapsedRefs]);

  const graphItemIds = useMemo(
    () =>
      new Set([
        ...graph.nodes.map((node) => nodeId(node.ref)),
        ...graph.actions.map((action, index) => actionId(index, action.name)),
      ]),
    [graph],
  );

  useEffect(() => {
    pruneSelectedNodeIds(graphItemIds);
  }, [graphItemIds, pruneSelectedNodeIds]);

  const toggleKind = (kind: VacpNodeKind) => {
    setActiveKinds((current) =>
      current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind],
    );
  };

  const resetFilters = () => {
    setQuery('');
    setActiveKinds([]);
    setFocusSelection(false);
  };

  return (
    <ModuleRoot
      rootRef={rootRef}
      boundWide={boundWide}
      className={cn(
        'h-full min-h-0',
        dense ? 'gap-2' : 'gap-3',
        showSideBySide ? 'grid grid-cols-[minmax(0,1fr)_minmax(320px,420px)]' : 'flex flex-col',
      )}
      data-vacp-graph="1"
      data-vacp-direction={direction}
      data-vacp-graph-renderer="xyflow"
    >
      <ModulePane className={cn('flex min-h-0 flex-1 flex-col', dense ? 'gap-2' : 'gap-3')}>
        <ModuleHeader
          title="Graph"
          description="Select an entity to inspect its state and relationships."
          compact={compactControls}
          actions={
            <>
              <IconButton
                icon={
                  direction === 'LR' ? (
                    <ArrowLeftRight className="h-4 w-4 text-neutral-100/90" />
                  ) : (
                    <ArrowUpDown className="h-4 w-4 text-neutral-100/90" />
                  )
                }
                label="Toggle direction"
                title="Toggle graph direction."
                size={iconButtonSize}
                onClick={toggleDirection}
              />
              <IconButton
                icon={<Zap className="h-4 w-4 text-neutral-100/90" />}
                label={includeActions ? 'Hide actions' : 'Show actions'}
                title="Show semantic actions as graph nodes."
                pressed={includeActions}
                size={iconButtonSize}
                onClick={() => toggleIncludeActions(includeActionsDefault)}
              />
              <IconButton
                icon={
                  mermaidCopied ? (
                    <Check className="h-4 w-4 text-emerald-100/90" />
                  ) : (
                    <Workflow className="h-4 w-4 text-neutral-100/90" />
                  )
                }
                label={mermaidCopied ? 'Copied Mermaid' : 'Copy Mermaid'}
                title={mermaidCopied ? 'Mermaid source copied.' : 'Copy Mermaid graph source.'}
                pressed={mermaidCopied}
                size={iconButtonSize}
                onClick={() => void copyMermaid()}
              />
              <span className="sr-only" role="status" aria-live="polite">
                {mermaidCopied ? 'Mermaid source copied.' : ''}
              </span>
              <IconButton
                icon={
                  effectiveInspectOpen ? (
                    <PanelRightClose className="h-4 w-4 text-neutral-100/90" />
                  ) : (
                    <PanelRightOpen className="h-4 w-4 text-neutral-100/90" />
                  )
                }
                disabled={!selected}
                label={effectiveInspectOpen ? 'Hide inspect pane' : 'Show inspect pane'}
                title={effectiveInspectOpen ? 'Hide the Inspect pane.' : 'Select an entity to inspect its state.'}
                pressed={effectiveInspectOpen}
                size={iconButtonSize}
                onClick={() => setInspectOpen(!inspectOpen)}
              />
            </>
          }
        />

        <div data-vacp-graph-controls="1" className={cn('grid gap-2 py-1', dense && 'p-1.5')}>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <label className="relative min-w-[180px] flex-1">
              <span className="sr-only">Search graph</span>
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-100/45" />
              <Input
                data-vacp-graph-search="1"
                className="h-8 pl-7 text-xs"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search refs, fields, actions"
              />
            </label>
            <button
              type="button"
              data-vacp-graph-focus-selection="1"
              className={cn(
                'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11px] font-semibold',
                focusSelection
                  ? 'border-teal-100/18 bg-teal-200/[0.07] text-teal-50/86'
                  : 'border-white/[0.075] bg-white/[0.025] text-neutral-100/68',
                !selected && 'opacity-45',
              )}
              disabled={!selected}
              aria-pressed={focusSelection}
              onClick={() => setFocusSelection((value) => !value)}
            >
              <LocateFixed className="h-3.5 w-3.5" />
              <span>Focus</span>
            </button>
            <button
              type="button"
              data-vacp-graph-reset-filters="1"
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-white/[0.075] bg-white/[0.025] px-2 text-[11px] font-semibold text-neutral-100/68 disabled:opacity-45"
              disabled={!filtersActive}
              onClick={resetFilters}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset</span>
            </button>
          </div>
          <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-white/[0.075] bg-white/[0.025] px-2 text-[10px] font-semibold text-neutral-100/62">
              <Filter className="h-3 w-3" />
              Kinds
            </span>
            {kindCounts.map(({ kind, count }) => {
              const active = activeKinds.includes(kind);

              return (
                <button
                  key={kind}
                  type="button"
                  data-vacp-graph-kind-filter={kind}
                  className={cn(
                    'inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 text-[10px] font-semibold',
                    active
                      ? 'border-teal-100/18 bg-teal-200/[0.07] text-teal-50/86'
                      : 'border-white/[0.075] bg-white/[0.025] text-neutral-100/62',
                  )}
                  aria-pressed={active}
                  onClick={() => toggleKind(kind)}
                >
                  <span>{kind}</span>
                  <span className="text-neutral-100/46">{count}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-neutral-100/52">
            <span data-vacp-graph-filter-summary="1">
              Showing {filteredGraph.nodes.length} of {graph.nodes.length} nodes and {filteredGraph.edges.length} of{' '}
              {graph.edges.length} edges.
            </span>
            {layerSummary ? <span data-vacp-graph-layer-summary="1">Layer groups: {layerSummary}</span> : null}
          </div>
        </div>

        <ModulePane tone="surface" className="vacp-inspector-flow h-full min-h-0 w-full overflow-hidden">
          <VacpGraphFlow nodes={flow.nodes} edges={flow.edges} counts={flow.counts} onSelect={selectGraphItem} />
        </ModulePane>
      </ModulePane>

      {effectiveInspectOpen ? (
        <ModulePane
          className={cn('flex min-h-0 flex-col', !showSideBySide && 'max-h-[45%]', dense ? 'gap-2' : 'gap-3')}
        >
          <ModuleHeader
            title="Inspect"
            description={selectedDescription(selected)}
            compact={compactControls}
            actions={
              <>
                <IconButton
                  icon={<XCircle className="h-4 w-4 text-neutral-100/90" />}
                  label="Clear selection"
                  title="Clear the selected node or action."
                  size={iconButtonSize}
                  onClick={() => selectGraphItem(null)}
                />
                <IconButton
                  icon={<ClipboardCopy className="h-4 w-4 text-neutral-100/90" />}
                  label="Copy JSON"
                  title="Copy the inspected JSON to clipboard."
                  size={iconButtonSize}
                  onClick={() => void copyTextToClipboard(inspectorText)}
                />
              </>
            }
          />

          <JsonViewer value={selected ? inspectorValue : null} className={cn('flex-1', dense && 'p-2')} />
        </ModulePane>
      ) : null}
    </ModuleRoot>
  );
}
